import 'react-native-gesture-handler';
/**
 * @format
 */

import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
// MainActivity.getMainComponentName() returns "AuralFlowMobile"; register it explicitly
// so release builds (where app.json name differs) don't crash on launch.
AppRegistry.registerComponent('AuralFlowMobile', () => App);
TrackPlayer.registerPlaybackService(() => require('./src/player/playbackService'));
