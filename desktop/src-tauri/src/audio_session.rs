//! 音量合成器里的应用身份：把 WebView2 播放的音频会话改写成「AuralFlow + 本应用图标」。
//!
//! 桌面端的声音由 WebView2 播放，而 WebView2 的音频跑在自己的
//! `--utility-sub-type=audio.mojom.AudioService` 子进程里：那个进程既没有
//! `--app-user-model-id`（该参数只发给浏览器进程），也不是打包应用，于是系统按 exe 身份
//! 把本应用的音频显示成「Microsoft Edge WebView2」+ Edge 图标。用户在音量合成器里看到的
//! 就是这样一项，既认不出应用，也对不上任务栏图标。
//!
//! 实测结论（Windows 11 26300 / WebView2 154，见 `docs/desktop-volume-mixer-identity.md`）：
//!
//! 1. 音频会话的名称与图标**允许被其它进程改写**：`IAudioSessionControl::SetDisplayName`
//!    与 `SetIconPath` 对「别人拥有的会话」同样返回 `S_OK`，且立刻能读回新值；
//! 2. 合成器优先显示会话自己登记的名称/图标，只有它们为空时才退回进程身份
//!    （对照：`pure_live` 的会话登记了 `package:media_kit`，合成器就显示它）。
//!
//! 因此这里起一个后台线程按秒轮询默认渲染端点上的音频会话，**只**改写「进程链能追到本应用」
//! 且名称/图标还不是目标值的那些会话。会话在开始出声时才出现，轮询是拿到它们的唯一低成本
//! 手段；稳态下一个 tick 只有一次会话枚举（微秒级），没有会话时几乎不做事。
//!
//! 失败一律降级：任何 Win32/COM 一步出错只记日志，播放与其它功能不受影响。

use std::path::Path;
use std::time::Duration;

/// 音量合成器里显示的应用名。
///
/// 与 `main.rs` 的 `APP_USER_MODEL_ID` 一样属于「对外身份」：改这里等于改用户在系统音量
/// 面板里看到的名字，勿与前端界面里的显示名混用（那个由 UI 自己决定）。
const SESSION_DISPLAY_NAME: &str = "AuralFlow";

/// 轮询间隔：会话出现得比这一秒更晚（切歌、恢复播放）也只会晚一个 tick 被改写。
const POLL_INTERVAL: Duration = Duration::from_millis(1000);

/// 进程链最多向上追溯的层数：真实层级个位数，这里只是防御异常进程表把线程拖死。
const MAX_ANCESTOR_DEPTH: usize = 64;

/// 缓存条数上限：超过就整体丢弃重建，长跑期间不会无界增长。
const TRACKER_CAPACITY: usize = 64;

// ─── 纯函数层（不碰 Win32/COM，可单测） ─────────────────────────

/// 写进会话的图标串：`<exe 路径>,0`。
///
/// 系统按「资源路径,索引」解析它（`SetIconPath` 存的就是字符串本身），索引 0 是 exe 的主
/// 图标——与安装器按 `bundle.icon` 写进 exe 的那个图标是同一个，所以合成器、任务栏、
/// 开始菜单三处图标自然一致。
pub fn session_icon_value(exe: &Path) -> String {
    format!("{},0", exe.display())
}

/// 会话当前的名称/图标是否还需要改写（已经等于目标值就什么都不用做）。
pub fn session_needs_patch(
    current_name: &str,
    current_icon: &str,
    target_name: &str,
    target_icon: &str,
) -> bool {
    current_name != target_name || current_icon != target_icon
}

/// `links` 是「pid → 父 pid」表：判断 `pid` 是不是 `ancestor` 的后代（**不含自身**）。
///
/// 音频会话属于 WebView2 的子进程（音频服务是浏览器进程的子进程，即本应用的孙进程），
/// 所以判定必须走完整条进程链，不能只看直接父进程。
///
/// 父子关系理论上不成环，但异常数据不该把调用方拖进死循环：追溯层数有上限，
/// `parent == 0`（无父进程）与 `parent == pid`（自指）都按「不是后代」处理。
pub fn is_descendant_of(links: &[(u32, u32)], pid: u32, ancestor: u32) -> bool {
    let mut current = pid;
    for _ in 0..MAX_ANCESTOR_DEPTH {
        let Some((_, parent)) = links.iter().find(|(child, _)| *child == current) else {
            return false;
        };
        let parent = *parent;
        if parent == 0 || parent == current {
            return false;
        }
        if parent == ancestor {
            return true;
        }
        current = parent;
    }
    false
}

/// 启动后台改写线程（非 Windows 构建上是 no-op）。
pub fn setup() {
    platform::setup();
}

// ─── Windows 实现 ─────────────────────────────────────────────

#[cfg(windows)]
mod platform {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::ffi::c_void;
    use tauri_plugin_log::log;
    use windows::core::{HSTRING, Interface, GUID, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    /// 轮询线程的长期状态。
    #[derive(Default)]
    struct Tracker {
        /// pid → 该进程是不是本应用的后代。进程身份不随时间变化，因此可以按 pid 缓存，
        /// 避免每个 tick 都为同一批会话重建进程快照。
        ours: HashMap<u32, bool>,
        /// 已经记过「已改写」日志的 pid：日志只在第一次改写某个会话时出现。
        announced: HashSet<u32>,
    }

    impl Tracker {
        fn remember(&mut self, pid: u32, ours: bool) {
            if self.ours.len() >= TRACKER_CAPACITY {
                self.ours.clear();
                self.announced.clear();
            }
            self.ours.insert(pid, ours);
        }
    }

    /// 线程名会出现在调试器与日志里，出问题便于定位。
    pub fn setup() {
        let spawned = std::thread::Builder::new()
            .name("audio-session".to_string())
            .spawn(run);
        if let Err(err) = spawned {
            log::warn!(
                "[audio-session] 启动音频会话改写线程失败，音量合成器将显示 WebView2 身份: {}",
                err
            );
        }
    }

    fn run() {
        // 这个线程独占自己的 COM 套间；`_com` 活到线程结束（本函数不返回）。
        let _com = ComGuard::new();
        let mut tracker = Tracker::default();
        let mut warned = false;
        loop {
            match patch_once(&mut tracker) {
                // 同一类错误只报一次：轮询每秒都在跑，反复刷日志会把日志刷满
                Err(err) if !warned => {
                    warned = true;
                    log::warn!("[audio-session] 改写音频会话身份失败，本次运行不再重复记录: {}", err);
                }
                Err(_) => {}
                // 恢复成功（或本来无事可做）后重置，让下次失败能再次被记录
                Ok(()) => warned = false,
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    /// 单轮检查：枚举默认渲染端点上的会话，改写属于本应用且还未改过名的那些。
    fn patch_once(tracker: &mut Tracker) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(step("取自身 exe 路径"))?;
        let target_icon = session_icon_value(&exe);
        let our_pid = std::process::id();

        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(step("创建音频设备枚举器"))?;
        let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
            .map_err(step("取默认渲染端点"))?;
        let manager: IAudioSessionManager2 =
            unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(step("激活会话管理器"))?;
        let sessions = unsafe { manager.GetSessionEnumerator() }.map_err(step("枚举音频会话"))?;
        let count = unsafe { sessions.GetCount() }.map_err(step("读取会话数量"))?;

        for index in 0..count {
            // 会话可能在枚举与取值之间消失（对方进程退出），这属于正常现象：跳过本轮
            let Ok(control) = (unsafe { sessions.GetSession(index as i32) }) else {
                continue;
            };
            // 只有 IAudioSessionControl2 能给出进程 id；系统声音等会话没有进程 id，跳过
            let Ok(session) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            let Ok(pid) = (unsafe { session.GetProcessId() }) else {
                continue;
            };
            if pid == 0 {
                continue;
            }
            // 已知不是本应用的会话（别的播放器）：连字符串都不必读
            if tracker.ours.get(&pid) == Some(&false) {
                continue;
            }

            let (Ok(name), Ok(icon)) = (
                read_string(|| unsafe { control.GetDisplayName() }),
                read_string(|| unsafe { control.GetIconPath() }),
            ) else {
                continue;
            };
            if !session_needs_patch(&name, &icon, SESSION_DISPLAY_NAME, &target_icon) {
                continue;
            }

            // 只有真的需要改写时才做进程快照：ToolHelp 快照比会话枚举贵得多，
            // 而其它应用的会话（名字不等于我们的目标）在稳态下正是被这里挡掉的。
            let is_ours = match tracker.ours.get(&pid) {
                Some(flag) => *flag,
                None => {
                    let flag = is_descendant_of(&process_links()?, pid, our_pid);
                    tracker.remember(pid, flag);
                    flag
                }
            };
            if !is_ours {
                continue;
            }

            apply_identity(&control, SESSION_DISPLAY_NAME, &target_icon)?;
            if tracker.announced.insert(pid) {
                log::info!(
                    "[audio-session] 已把音频会话身份改写为 {}（pid={}）",
                    SESSION_DISPLAY_NAME,
                    pid
                );
            }
        }
        Ok(())
    }

    /// 写入名称与图标。两个 Setter 都允许跨进程调用（实测返回 `S_OK` 并能在合成器里生效）。
    fn apply_identity(
        control: &windows::Win32::Media::Audio::IAudioSessionControl,
        name: &str,
        icon: &str,
    ) -> Result<(), String> {
        // 全 0 的事件上下文：我们没有要关联的会话事件，系统也不校验这个 GUID
        let context = GUID::zeroed();
        let name = HSTRING::from(name);
        let icon = HSTRING::from(icon);
        unsafe { control.SetDisplayName(&name, &context) }.map_err(step("写入会话名称"))?;
        unsafe { control.SetIconPath(&icon, &context) }.map_err(step("写入会话图标"))?;
        Ok(())
    }

    /// 读会话字符串。`Get*Name` / `GetIconPath` 的返回值由 `CoTaskMemAlloc` 分配，
    /// 调用方负责释放：读完整串立刻 `CoTaskMemFree`，避免每秒轮询漏内存。
    fn read_string(get: impl FnOnce() -> windows::core::Result<PWSTR>) -> Result<String, String> {
        let value = get().map_err(step("读取会话字符串"))?;
        if value.is_null() {
            return Ok(String::new());
        }
        unsafe {
            let start = value.as_ptr();
            let mut len = 0usize;
            while *start.add(len) != 0 {
                len += 1;
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(start, len));
            CoTaskMemFree(Some(start as *const c_void));
            Ok(text)
        }
    }

    /// 当前进程表的快照（pid → 父 pid）。
    fn process_links() -> Result<Vec<(u32, u32)>, String> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
            .map_err(step("创建进程快照"))?;
        let guard = SnapshotGuard(snapshot);
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        unsafe { Process32FirstW(guard.0, &mut entry) }.map_err(step("遍历进程快照"))?;
        let mut links = Vec::new();
        loop {
            links.push((entry.th32ProcessID, entry.th32ParentProcessID));
            // 走到末尾时返回 ERROR_NO_MORE_FILES，是正常结束
            if unsafe { Process32NextW(guard.0, &mut entry) }.is_err() {
                break;
            }
        }
        Ok(links)
    }

    /// 快照句柄必须在同一线程释放，交给 RAII 兜住提前返回。
    struct SnapshotGuard(HANDLE);

    impl Drop for SnapshotGuard {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    /// 工作线程上的 COM 初始化。`CoInitializeEx` 每次成功都会让引用计数 +1，
    /// 因此这里成对释放；`RPC_E_CHANGED_MODE`（套间模式冲突）不改变计数，也不去反初始化。
    struct ComGuard {
        balance: bool,
    }

    impl ComGuard {
        fn new() -> Self {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            Self { balance: hr.is_ok() }
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.balance {
                unsafe { CoUninitialize() };
            }
        }
    }

    /// 错误串统一带上「哪一步失败」的前缀：`windows::core::Error` 与 `std::io::Error` 都能用。
    fn step<E: std::fmt::Display>(what: &'static str) -> impl Fn(E) -> String {
        move |err| format!("{}: {}", what, err)
    }
}

// ─── 非 Windows 构建占位 ──────────────────────────────────────

#[cfg(not(windows))]
mod platform {
    //! 桌面端只面向 Windows：这里只保证非 Windows 构建仍可编译。
    pub fn setup() {}
}

// ─── 单测（纯函数：不碰 COM、不读进程表） ──────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_value_uses_path_and_index_zero() {
        let value = session_icon_value(Path::new(r"D:\AuralFlow\auralflow.exe"));
        assert_eq!(value, r"D:\AuralFlow\auralflow.exe,0");
    }

    #[test]
    fn patch_needed_only_when_name_or_icon_differs() {
        let target = r"D:\AuralFlow\auralflow.exe,0";
        assert!(!session_needs_patch("AuralFlow", target, "AuralFlow", target));
        // WebView2 默认登记的名字：必须改写
        assert!(session_needs_patch(
            "Microsoft Edge WebView2",
            target,
            "AuralFlow",
            target
        ));
        assert!(session_needs_patch("AuralFlow", "其它图标", "AuralFlow", target));
        // 空名称（进程身份回退）同样需要改写
        assert!(session_needs_patch("", "", "AuralFlow", target));
    }

    #[test]
    fn descendant_walks_the_whole_chain() {
        // 9416 本应用 ← 22716 浏览器进程 ← 8264 音频服务进程
        let links = [(22716, 9416), (8264, 22716), (1, 0), (2, 999)];
        assert!(is_descendant_of(&links, 22716, 9416), "直接子进程");
        assert!(is_descendant_of(&links, 8264, 9416), "孙进程（音频服务就是这一层）");
        assert!(!is_descendant_of(&links, 9416, 9416), "自身不算后代");
        assert!(!is_descendant_of(&links, 999, 9416), "父进程查不到");
    }

    #[test]
    fn descendant_rejects_broken_links() {
        // 自指 / 无父进程：都不能被当成「是本应用的孩子」
        assert!(!is_descendant_of(&[(5, 5)], 5, 9416));
        assert!(!is_descendant_of(&[(5, 0)], 5, 9416));
        assert!(!is_descendant_of(&[], 5, 9416));
    }

    #[test]
    fn descendant_stops_on_parent_cycle() {
        // 10 → 11 → 10 成环：必须在上限内退出并给出「不是后代」
        let links = [(10, 11), (11, 10)];
        assert!(!is_descendant_of(&links, 10, 9416));
    }
}
