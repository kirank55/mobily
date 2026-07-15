package expo.modules.mobilypinnedtransport

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.security.cert.CertificateException
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.CertificatePinner
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class MobilyPinnedTransportModule : Module() {
  private val sockets = ConcurrentHashMap<String, WebSocket>()

  override fun definition() = ModuleDefinition {
    Name("MobilyPinnedTransport")
    Events("webSocketOpen", "webSocketMessage", "webSocketClosed", "webSocketFailure")

    AsyncFunction("request") { url: String, pin: String, method: String, body: String? ->
      val requestBuilder = Request.Builder().url(url)
      if (method.uppercase() == "POST") {
        requestBuilder.post((body ?: "").toRequestBody("application/json".toMediaType()))
      } else {
        requestBuilder.method(method.uppercase(), null)
      }
      pinnedClient(url, pin).newCall(requestBuilder.build()).execute().use { response ->
        mapOf("status" to response.code, "body" to (response.body?.string() ?: ""))
      }
    }

    Function("openWebSocket") { id: String, url: String, pin: String ->
      val request = Request.Builder().url(url).build()
      val socket = pinnedClient(url, pin).newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          sendEvent("webSocketOpen", mapOf("id" to id))
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          sendEvent("webSocketMessage", mapOf("id" to id, "data" to text))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          sockets.remove(id)
          sendEvent("webSocketClosed", mapOf("id" to id, "code" to code, "reason" to reason))
        }

        override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
          sockets.remove(id)
          sendEvent("webSocketFailure", mapOf("id" to id, "message" to (error.message ?: "network error")))
        }
      })
      sockets[id] = socket
      true
    }

    Function("sendWebSocket") { id: String, data: String -> sockets[id]?.send(data) ?: false }
    Function("closeWebSocket") { id: String, code: Int, reason: String ->
      sockets.remove(id)?.close(code, reason) ?: false
    }

    OnDestroy {
      sockets.values.forEach { it.cancel() }
      sockets.clear()
    }
  }

  private fun pinnedClient(url: String, pin: String): OkHttpClient {
    require(pin.matches(Regex("^sha256/[A-Za-z0-9+/]{43}=$"))) { "Invalid certificate pin" }
    val host = url.toHttpUrl().host
    val trustManager = PinTrustManager(pin)
    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(null, arrayOf(trustManager), SecureRandom())
    return OkHttpClient.Builder()
      .sslSocketFactory(sslContext.socketFactory, trustManager)
      .hostnameVerifier { _, session ->
        session.peerCertificates.filterIsInstance<X509Certificate>().any { certificatePin(it) == pin }
      }
      .certificatePinner(CertificatePinner.Builder().add(host, pin).build())
      .build()
  }
}

private class PinTrustManager(private val expectedPin: String) : X509TrustManager {
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    if (chain.isEmpty() || certificatePin(chain[0]) != expectedPin) {
      throw CertificateException("Station certificate pin mismatch")
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

private fun certificatePin(certificate: X509Certificate): String {
  val digest = MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded)
  return "sha256/" + Base64.encodeToString(digest, Base64.NO_WRAP)
}
