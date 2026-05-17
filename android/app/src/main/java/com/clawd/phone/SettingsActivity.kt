package com.clawd.phone

import android.app.Activity
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.clawd.phone.databinding.ActivitySettingsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding

    private var permissionSoundUri: String? = null
    private var finishedSoundUri: String? = null

    private val pickPermissionSound = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val uri = result.data
                ?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
            permissionSoundUri = uri?.toString()
            binding.soundPermissionBtn.text = getRingtoneName(uri)
        }
    }

    private val pickFinishedSound = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val uri = result.data
                ?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
            finishedSoundUri = uri?.toString()
            binding.soundFinishedBtn.text = getRingtoneName(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        loadSettings()

        binding.testConnectionBtn.setOnClickListener { testConnection() }
        binding.soundPermissionBtn.setOnClickListener {
            openRingtonePicker(pickPermissionSound, permissionSoundUri)
        }
        binding.soundFinishedBtn.setOnClickListener {
            openRingtonePicker(pickFinishedSound, finishedSoundUri)
        }
        binding.saveBtn.setOnClickListener { saveAndReturn() }
    }

    private fun loadSettings() {
        val prefs = getSharedPreferences(Prefs.NAME, MODE_PRIVATE)

        binding.serverUrlInput.setText(prefs.getString(Prefs.KEY_SERVER_URL, ""))
        binding.soundEnabledSwitch.isChecked = prefs.getBoolean(Prefs.KEY_SOUND_ENABLED, true)
        binding.autoStartSwitch.isChecked = prefs.getBoolean(Prefs.KEY_AUTO_START, true)

        permissionSoundUri = prefs.getString(Prefs.KEY_SOUND_PERMISSION_URI, null)
        finishedSoundUri = prefs.getString(Prefs.KEY_SOUND_FINISHED_URI, null)

        binding.soundPermissionBtn.text = getRingtoneName(
            permissionSoundUri?.let { Uri.parse(it) }
        )
        binding.soundFinishedBtn.text = getRingtoneName(
            finishedSoundUri?.let { Uri.parse(it) }
        )

        val vibrateIntensity = prefs.getInt(Prefs.KEY_VIBRATE_INTENSITY, Prefs.VIBRATE_MEDIUM)
        binding.vibrateSpinner.setSelection(vibrateIntensity.coerceIn(0, 3))
    }

    private fun getRingtoneName(uri: Uri?): String {
        if (uri == null) return getString(R.string.sound_default)
        val ringtone = RingtoneManager.getRingtone(this, uri)
        return ringtone?.getTitle(this) ?: getString(R.string.sound_default)
    }

    private fun openRingtonePicker(
        launcher: ActivityResultLauncher<Intent>,
        currentUri: String?
    ) {
        val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
            putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_NOTIFICATION)
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
            val existingUri = if (!currentUri.isNullOrBlank()) {
                Uri.parse(currentUri)
            } else {
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            }
            putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, existingUri)
        }
        launcher.launch(intent)
    }

    private fun testConnection() {
        val url = binding.serverUrlInput.text?.toString()?.trim()
        if (url.isNullOrBlank()) {
            showStatus(getString(R.string.url_required), false)
            return
        }

        binding.testConnectionBtn.isEnabled = false
        binding.connectionStatus.visibility = View.VISIBLE
        binding.connectionStatus.text = "Testing..."
        binding.connectionStatus.setTextColor(getColor(android.R.color.darker_gray))

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                ConnectionChecker.check(url)
            }
            binding.testConnectionBtn.isEnabled = true
            when (result) {
                is ConnectionResult.Success ->
                    showStatus(getString(R.string.connection_success), true)
                is ConnectionResult.InvalidUrl ->
                    showStatus(getString(R.string.url_invalid), false)
                is ConnectionResult.HttpError ->
                    showStatus("${getString(R.string.connection_failed)} (HTTP ${result.code})", false)
                is ConnectionResult.NetworkError ->
                    showStatus(getString(R.string.connection_failed), false)
            }
        }
    }

    private fun showStatus(message: String, success: Boolean) {
        binding.connectionStatus.visibility = View.VISIBLE
        binding.connectionStatus.text = message
        binding.connectionStatus.setTextColor(
            if (success) getColor(android.R.color.holo_green_light)
            else getColor(android.R.color.holo_red_light)
        )
    }

    private fun saveAndReturn() {
        val url = binding.serverUrlInput.text?.toString()?.trim()
        if (url.isNullOrBlank()) {
            Toast.makeText(this, R.string.url_required, Toast.LENGTH_SHORT).show()
            return
        }

        getSharedPreferences(Prefs.NAME, MODE_PRIVATE)
            .edit()
            .putString(Prefs.KEY_SERVER_URL, url)
            .putBoolean(Prefs.KEY_SOUND_ENABLED, binding.soundEnabledSwitch.isChecked)
            .putString(Prefs.KEY_SOUND_PERMISSION_URI, permissionSoundUri)
            .putString(Prefs.KEY_SOUND_FINISHED_URI, finishedSoundUri)
            .putInt(Prefs.KEY_VIBRATE_INTENSITY, binding.vibrateSpinner.selectedItemPosition)
            .putBoolean(Prefs.KEY_AUTO_START, binding.autoStartSwitch.isChecked)
            .apply()

        finish()
    }
}
