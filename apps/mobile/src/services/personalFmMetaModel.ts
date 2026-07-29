interface PersonalFmAccountMeta {
  nickname?: string | null;
}

export interface PersonalFmMeta {
  title: string;
  subtitle: string;
}

const TITLE = "私人 FM";
const LOGGED_OUT_SUBTITLE = "登录网易云后即可开始私人 FM。";
const GENERIC_LOGGED_IN_SUBTITLE = "基于网易云登录态生成的连续电台。";

export function buildPersonalFmMeta(isLoggedIn: boolean, account: PersonalFmAccountMeta | null): PersonalFmMeta {
  if (!isLoggedIn) {
    return {
      title: TITLE,
      subtitle: LOGGED_OUT_SUBTITLE,
    };
  }

  const nickname = account?.nickname?.trim();
  return {
    title: TITLE,
    subtitle: nickname ? `正在为 ${nickname} 播放推荐曲目` : GENERIC_LOGGED_IN_SUBTITLE,
  };
}
