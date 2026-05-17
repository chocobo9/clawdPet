package com.clawd.phone

import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.clawd.phone.databinding.ActivitySettingsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        loadSavedUrl()

        binding.testConnectionBtn.setOnClickListener { testConnection() }
        binding.saveBtn.setOnClickListener { saveAndReturn() }
    }

    private fun loadSavedUrl() {
        val saved = getSharedPreferences(Prefs.NAME, MODE_PRIVATE)
            .getString(Prefs.KEY_SERVER_URL, "")
        binding.serverUrlInput.setText(saved)
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
            .apply()

        finish()
    }
}
