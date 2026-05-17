package com.clawd.phone

import android.annotation.SuppressLint
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.clawd.phone.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var backKeyDownTime = 0L

    companion object {
        const val LONG_PRESS_THRESHOLD_MS = 800L

        fun isLongPress(heldMs: Long): Boolean = heldMs >= LONG_PRESS_THRESHOLD_MS
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterFullscreen()
        setupWebView()
        setupNetworkMonitor()

        val url = getServerUrl()
        if (url.isNullOrBlank()) {
            showNoConnection()
            openSettings()
        } else {
            loadDashboard(url)
        }
    }

    override fun onResume() {
        super.onResume()
        enterFullscreen()
        val url = getServerUrl()
        if (!url.isNullOrBlank()) {
            binding.noConnectionView.visibility = View.GONE
            binding.webView.visibility = View.VISIBLE
            val currentUrl = binding.webView.url
            if (currentUrl == null || !currentUrl.startsWith(url)) {
                loadDashboard(url)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        networkCallback?.let {
            val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
            cm.unregisterNetworkCallback(it)
        }
        binding.webView.destroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                backKeyDownTime = event.eventTime
                return true
            }
            if (event.action == KeyEvent.ACTION_UP && backKeyDownTime > 0L) {
                val held = event.eventTime - backKeyDownTime
                backKeyDownTime = 0L
                if (isLongPress(held)) {
                    openSettings()
                } else if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                }
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        binding.webView.apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.mediaPlaybackRequiresUserGesture = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT

            addJavascriptInterface(AlarmBridge(this@MainActivity), "Android")

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError
                ) {
                    if (request.isForMainFrame) {
                        showNoConnection()
                    }
                }
            }
        }
    }

    private fun enterFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { controller ->
                controller.hide(
                    WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars()
                )
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        }
    }

    private fun setupNetworkMonitor() {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    val url = getServerUrl()
                    if (!url.isNullOrBlank() && binding.noConnectionView.visibility == View.VISIBLE) {
                        loadDashboard(url)
                    }
                }
            }

            override fun onLost(network: Network) {
                runOnUiThread { showNoConnection() }
            }
        }

        cm.registerNetworkCallback(request, networkCallback!!)
    }

    private fun loadDashboard(url: String) {
        binding.noConnectionView.visibility = View.GONE
        binding.webView.visibility = View.VISIBLE
        binding.webView.loadUrl(url)

        KeepAliveService.start(this)
    }

    private fun showNoConnection() {
        binding.noConnectionView.visibility = View.VISIBLE
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    private fun getServerUrl(): String? {
        return getSharedPreferences(Prefs.NAME, MODE_PRIVATE)
            .getString(Prefs.KEY_SERVER_URL, null)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterFullscreen()
    }
}
