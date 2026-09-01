//! 凭证字段加密（Windows DPAPI）
//!
//! 配置文件此前以明文保存 Cookie 与 WebDAV 密码。文件位于 app_data_dir，
//! ACL 仅为默认继承，任何以当前用户身份运行的进程可直读 —— 这正是
//! cookie 窃取类恶意软件的标准取材路径。这里改为落盘前用 DPAPI
//! (CryptProtectData) 按当前用户加密，密钥由 Windows 派生自用户登录凭据，
//! 换用户或换机器都无法解密。
//!
//! 仅支持 Windows：本项目桌面端只面向 Windows 自用，其他平台在编译期
//! 直接失败而非静默退回明文 —— 静默退回会让「凭证已加密」变成假承诺。
//!
//! 密文以 `DPAPI:v1:<base64>` 形式存放，与明文可区分，因此旧配置文件
//! 无需迁移步骤：读取时按前缀判断，无前缀即视为历史明文原样返回，
//! 下一次保存自动升级为密文。

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// 密文前缀。带版本号，便于将来更换算法时区分。
const CIPHER_PREFIX: &str = "DPAPI:v1:";

/// 判断字符串是否为本模块产出的密文。
fn is_encrypted(value: &str) -> bool {
    value.starts_with(CIPHER_PREFIX)
}

/// 加密单个凭证值。已是密文则原样返回，避免重复加密。
pub fn protect(value: &str) -> Result<String, String> {
    if value.is_empty() || is_encrypted(value) {
        return Ok(value.to_string());
    }
    let cipher = platform::protect(value.as_bytes())?;
    Ok(format!("{}{}", CIPHER_PREFIX, BASE64.encode(cipher)))
}

/// 解密单个凭证值。
///
/// 无前缀视为历史明文，原样返回（首次升级路径）。
/// 有前缀但解密失败则返回错误 —— 不静默清空，也不把密文当明文交给上层，
/// 否则用户会看到「已登录」但请求全部 401，比显式报错更难排查。
pub fn unprotect(value: &str) -> Result<String, String> {
    let Some(encoded) = value.strip_prefix(CIPHER_PREFIX) else {
        return Ok(value.to_string());
    };
    let cipher = BASE64
        .decode(encoded)
        .map_err(|e| format!("凭证密文 base64 解码失败: {}", e))?;
    let plain = platform::unprotect(&cipher)?;
    String::from_utf8(plain).map_err(|e| format!("凭证解密后不是合法 UTF-8: {}", e))
}

#[cfg(windows)]
mod platform {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    /// DPAPI 输出缓冲区由系统用 LocalAlloc 分配，读取后必须 LocalFree。
    /// 用 guard 保证任何返回路径都会释放。
    struct OutBlob(CRYPT_INTEGER_BLOB);

    impl OutBlob {
        fn to_vec(&self) -> Vec<u8> {
            if self.0.pbData.is_null() || self.0.cbData == 0 {
                return Vec::new();
            }
            unsafe { std::slice::from_raw_parts(self.0.pbData, self.0.cbData as usize).to_vec() }
        }
    }

    impl Drop for OutBlob {
        fn drop(&mut self) {
            if !self.0.pbData.is_null() {
                unsafe {
                    let _ = LocalFree(Some(HLOCAL(self.0.pbData as *mut core::ffi::c_void)));
                }
            }
        }
    }

    fn in_blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        let input = in_blob(plain);
        let mut out = OutBlob(CRYPT_INTEGER_BLOB::default());
        unsafe {
            CryptProtectData(&input, None, None, None, None, 0, &mut out.0)
                .map_err(|e| format!("DPAPI 加密失败: {}", e))?;
        }
        Ok(out.to_vec())
    }

    pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
        let input = in_blob(cipher);
        let mut out = OutBlob(CRYPT_INTEGER_BLOB::default());
        unsafe {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut out.0)
                .map_err(|e| format!("DPAPI 解密失败: {}", e))?;
        }
        Ok(out.to_vec())
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn protect(_plain: &[u8]) -> Result<Vec<u8>, String> {
        Err("凭证加密仅支持 Windows（DPAPI），当前平台无实现".to_string())
    }

    pub fn unprotect(_cipher: &[u8]) -> Result<Vec<u8>, String> {
        Err("凭证解密仅支持 Windows（DPAPI），当前平台无实现".to_string())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_preserves_value() {
        let plain = "MUSIC_U=abc123; __csrf=deadbeef";
        let cipher = protect(plain).expect("加密应成功");
        assert!(cipher.starts_with(CIPHER_PREFIX), "密文应带前缀");
        assert!(!cipher.contains("MUSIC_U"), "密文不应残留明文");
        assert_eq!(unprotect(&cipher).expect("解密应成功"), plain);
    }

    #[test]
    fn roundtrip_handles_non_ascii() {
        let plain = "密码：测试值-1";
        let cipher = protect(plain).expect("加密应成功");
        assert_eq!(unprotect(&cipher).expect("解密应成功"), plain);
    }

    #[test]
    fn protect_is_idempotent() {
        let once = protect("token").expect("首次加密应成功");
        let twice = protect(&once).expect("二次加密应短路");
        assert_eq!(once, twice, "已加密值不应被重复加密");
    }

    #[test]
    fn empty_value_passes_through() {
        assert_eq!(protect("").expect("空值应短路"), "");
        assert_eq!(unprotect("").expect("空值应短路"), "");
    }

    #[test]
    fn legacy_plaintext_reads_unchanged() {
        // 旧配置文件里的无前缀明文必须原样读出，否则升级即丢登录态。
        let legacy = "MUSIC_U=legacy_plain_value";
        assert_eq!(unprotect(legacy).expect("明文应原样返回"), legacy);
    }

    #[test]
    fn corrupted_cipher_errors_loudly() {
        // 篡改的密文必须报错，不能退回当明文使用 —— 否则表现为
        // 「已登录但全部请求 401」，比显式失败更难排查。
        let tampered = format!("{}bm90LWEtcmVhbC1ibG9i", CIPHER_PREFIX);
        assert!(unprotect(&tampered).is_err(), "损坏密文应报错");
    }
}
