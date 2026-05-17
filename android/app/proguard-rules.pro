# ClawdPhone ProGuard rules
# Keep JavaScript interface methods
-keepclassmembers class com.clawd.phone.AlarmBridge {
    @android.webkit.JavascriptInterface <methods>;
}
