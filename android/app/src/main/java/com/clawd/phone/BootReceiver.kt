package com.clawd.phone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = context.getSharedPreferences(Prefs.NAME, Context.MODE_PRIVATE)
        val autoStart = prefs.getBoolean(Prefs.KEY_AUTO_START, true)
        if (!autoStart) {
            Log.d(TAG, "Auto-start disabled, skipping")
            return
        }

        val url = prefs.getString(Prefs.KEY_SERVER_URL, null)
        if (url.isNullOrBlank()) {
            Log.d(TAG, "No server URL configured, skipping")
            return
        }

        Log.i(TAG, "Boot completed, launching ClawdPet")
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(launchIntent)
    }
}
