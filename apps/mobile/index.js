import 'react-native-gesture-handler';
/**
 * @format
 */

import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { installGlobalErrorCapture } from './src/services/globalErrorCapture';
import { name as appName } from './app.json';

// 尽早安装：release 包里 JS/worklet 未捕获异常会直接闪退不留痕，
// 这里先落盘（下次启动屏展示），再走 RN 默认崩溃流程
installGlobalErrorCapture();

AppRegistry.registerComponent(appName, () => App);
// MainActivity.getMainComponentName() returns "AuralFlowMobile"; register it explicitly
// so release builds (where app.json name differs) don't crash on launch.
AppRegistry.registerComponent('AuralFlowMobile', () => App);
TrackPlayer.registerPlaybackService(() => require('./src/player/playbackService'));
