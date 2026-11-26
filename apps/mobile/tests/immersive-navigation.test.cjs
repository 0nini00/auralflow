const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createLoader, mobileRequire } = require('./helpers/loadTs.cjs');
const { createImmersiveScreen } = require('./helpers/immersiveScreen.cjs');

// 使用安装版本的真实路由算法，验证出栈/压栈后的页面，而不是只记录导航函数调用。
const nativeRoot = path.dirname(mobileRequire.resolve('@react-navigation/native/package.json'));
const { StackRouter, StackActions, CommonActions } = mobileRequire(
  mobileRequire.resolve('@react-navigation/routers', { paths: [nativeRoot] }),
);

function navigationStack() {
  const router = StackRouter({ initialRouteName: 'MainTabs' });
  const options = {
    routeNames: ['MainTabs', 'Player', 'SimilarSongs', 'MvPlayer'],
    routeParamList: {}, routeGetIdList: {},
  };
  let state = router.getInitialState(options);
  const dispatch = action => {
    const next = router.getStateForAction(state, action, options);
    assert.ok(next, `导航动作必须被处理：${action.type}`);
    state = next;
  };
  dispatch(StackActions.push('Player'));
  const navigation = createLoader({
    '@react-navigation/native': {
      createNavigationContainerRef: () => ({
        isReady: () => true, dispatch,
        navigate: (name, params) => dispatch(CommonActions.navigate(name, params)),
      }),
      StackActions,
    },
    '@/stores/settingsCategoryStore': {},
    '@/stores/librarySectionStore': {},
  })('src/navigation/navigationRef.ts');
  return {
    navigation,
    back: () => dispatch(CommonActions.goBack()),
    routes: () => state.routes,
  };
}

for (const [callback, destination] of [['onOpenSimilarSongs', 'SimilarSongs'], ['onPlayMv', 'MvPlayer']]) {
  test(`更多菜单打开 ${destination} 后返回同一个竖屏播放器实例`, async t => {
    const stack = navigationStack();
    const player = stack.routes().at(-1);
    const h = await createImmersiveScreen(t, { navigation: stack.navigation, onClose: stack.back });
    await h.invoke('ImmersiveTransport', 'onOpenMore');
    await h.invoke('ImmersiveMoreMenu', 'onClose');
    await h.invoke('ImmersiveMoreMenu', callback);
    assert.deepEqual(stack.routes().map(route => route.name), ['MainTabs', 'Player', destination]);
    assert.equal(stack.routes()[1].key, player.key);
    stack.back();
    assert.equal(stack.routes().at(-1).key, player.key);
    assert.equal(h.mounts(), 1);
  });
}

test('播放器失焦后释放系统返回键、停止动画和常亮，返回恢复原页面', async t => {
  const h = await createImmersiveScreen(t, { controller: { currentPage: 1, isLyricsPage: true } });
  assert.equal(h.backListeners(), 1);
  assert.equal(h.background().active, true);
  assert.equal(h.root.root.findAllByType('KeepAwake').length, 1);
  await h.focus(false);
  assert.equal(h.backListeners(), 0, '被其它页面覆盖的播放器不能拦截系统返回键');
  assert.equal(h.background().active, false);
  assert.equal(h.controllerActive(), false);
  assert.equal(h.props('LyricView').active, false);
  assert.equal(h.props('ImmersiveCoverPage').isPlaying, false);
  assert.equal(h.root.root.findAllByType('KeepAwake').length, 0);
  assert.equal(h.root.root.findAllByType('StatusBar').length, 0);
  await h.focus(true);
  assert.equal(h.backListeners(), 1);
  assert.equal(h.background().active, true);
  assert.equal(h.controllerActive(), true);
  assert.equal(h.props('LyricView').active, true);
  assert.equal(h.props('PagerView').initialPage, 1);
  assert.equal(h.mounts(), 1, '页面返回不应重建背景');
});

test('被覆盖的播放器遇到歌曲清空，不得退出上层页面；返回后才关闭空播放器', async t => {
  let closes = 0;
  const h = await createImmersiveScreen(t, { onClose: () => closes++ });
  await h.focus(false);
  await h.change({ currentSong: null });
  assert.equal(closes, 0);
  await h.focus(true);
  assert.equal(closes, 1);
});
