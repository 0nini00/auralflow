# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# KotlinAudio v2.1.0 的媒体会话扩展适配器访问这两个私有字段。
-keepclassmembers class com.doublesymmetry.kotlinaudio.notification.NotificationManager {
    com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector mediaSessionConnector;
}
-keepclassmembers class com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector {
    com.google.android.exoplayer2.ext.mediasession.MediaSessionConnector$CustomActionProvider[] customActionProviders;
}
