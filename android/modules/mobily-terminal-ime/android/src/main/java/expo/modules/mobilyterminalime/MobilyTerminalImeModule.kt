package expo.modules.mobilyterminalime

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class TerminalImeException(message: String) : CodedException(message)

/**
 * Forces the terminal WebView to become Android's served input view and open
 * the soft keyboard. Focusing xterm's helper textarea in JavaScript alone is
 * not enough on Android 16 / HyperOS: InputMethodManager rejects showSoftInput
 * until the native WebView owns the served input connection.
 */
class MobilyTerminalImeModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("MobilyTerminalIme")

    AsyncFunction("showSoftKeyboard") { promise: Promise ->
      val activity =
        appContext.currentActivity
          ?: throw TerminalImeException("Android activity is unavailable")
      mainHandler.post { showSoftKeyboard(activity, promise) }
    }

    AsyncFunction("hideSoftKeyboard") { promise: Promise ->
      val activity =
        appContext.currentActivity
          ?: throw TerminalImeException("Android activity is unavailable")
      mainHandler.post {
        val imm =
          activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        val token = activity.currentFocus?.windowToken
          ?: activity.window?.decorView?.windowToken
        val hidden =
          if (token != null) imm.hideSoftInputFromWindow(token, 0) else false
        promise.resolve(
          mapOf(
            "hidden" to hidden,
            "served" to (activity.currentFocus is WebView && imm.isActive(activity.currentFocus)),
          ),
        )
      }
    }
  }

  private fun showSoftKeyboard(activity: Activity, promise: Promise) {
    val webView = findWebView(activity.window?.decorView)
    if (webView == null) {
      promise.resolve(
        mapOf(
          "shown" to false,
          "served" to false,
          "reason" to "webview-missing",
        ),
      )
      return
    }

    webView.isFocusable = true
    webView.isFocusableInTouchMode = true
    webView.requestFocus()
    webView.requestFocusFromTouch()

    val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    attemptShow(webView, imm, promise, attemptsRemaining = 12)
  }

  private fun attemptShow(
    webView: WebView,
    imm: InputMethodManager,
    promise: Promise,
    attemptsRemaining: Int,
  ) {
    if (!webView.isFocused) {
      webView.requestFocus()
      webView.requestFocusFromTouch()
    }
    // Rebuild the input connection after the document focuses xterm's textarea.
    imm.restartInput(webView)
    val accepted = imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT)
    val served = imm.isActive(webView)

    if (served) {
      promise.resolve(
        mapOf(
          "shown" to true,
          "served" to true,
          "accepted" to accepted,
        ),
      )
      return
    }

    if (attemptsRemaining <= 0) {
      promise.resolve(
        mapOf(
          "shown" to false,
          "served" to false,
          "accepted" to accepted,
          "reason" to "not-served",
        ),
      )
      return
    }

    webView.postDelayed(
      { attemptShow(webView, imm, promise, attemptsRemaining - 1) },
      40L,
    )
  }

  private fun findWebView(root: View?): WebView? {
    if (root == null) return null
    if (root is WebView) return root
    if (root !is ViewGroup) return null
    for (index in 0 until root.childCount) {
      val found = findWebView(root.getChildAt(index))
      if (found != null) return found
    }
    return null
  }
}
