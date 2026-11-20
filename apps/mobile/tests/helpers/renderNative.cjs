const { createLoader, mobileRequire } = require('./loadTs.cjs');
const React = mobileRequire('react');
const renderer = mobileRequire('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const palette = new Proxy({}, { get: () => '#123456' });
const theme = {
  useThemeStore: selector => selector({ mode: 'light', systemTheme: 'light', accentColor: 'green' }),
  getResolvedTheme: () => 'light', getThemePalette: () => palette,
};
function host(name) { return ({ children, ...props }) => React.createElement(name, props, children); }
function createNativeRenderer(overrides = {}) {
  const interactions = [];
  const native = {
    View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ActivityIndicator: host('ActivityIndicator'),
    StyleSheet: { create: value => value, absoluteFill: {} }, Alert: { alert() {} },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
    InteractionManager: { runAfterInteractions: callback => { const task = { callback, cancelled: false, cancel() { this.cancelled = true; } }; interactions.push(task); return task; } },
    FlatList: host('FlatList'),
  };
  const load = createLoader({ react: React, 'react-native': native,
    'lucide-react-native': new Proxy({}, { get: (_, name) => host(String(name)) }),
    '@/stores/themeStore': theme, ...overrides });
  return { load, native, interactions };
}
module.exports = { React, renderer, host, theme, createNativeRenderer };
