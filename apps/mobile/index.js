import 'react-native-gesture-handler';
/**
 * @format
 */

import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { installGlobalErrorCapture } from './src/services/globalErrorCapture';
import { initLogger } from './src/services/logger';
import { name as appName } from './app.json';

// 尽早安装：release 包里 JS/worklet 未捕获异常会直接闪退不留痕，
// 这里先落盘（下次启动屏展示），再走 RN 默认崩溃流程
installGlobalErrorCapture();
// 运行日志落盘 + 全局异常/未处理拒绝兜底：同样尽早，启动行必须写进当天日志文件
initLogger();

AppRegistry.registerComponent(appName, () => App);
// MainActivity.getMainComponentName() returns "AuralFlowMobile"; register it explicitly
// so release builds (where app.json name differs) don't crash on launch.
AppRegistry.registerComponent('AuralFlowMobile', () => App);
TrackPlayer.registerPlaybackService(() => require('./src/player/playbackService'));
