package dev.agentmoataz.native

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure storage for provider API keys.
 *
 * Secrets NEVER enter the JS layer as plaintext config, are never logged,
 * and are only released to a specific provider adapter that resolves a
 * `secretRef` at request time. Keys live in Android Keystore-backed
 * EncryptedSharedPreferences.
 */
class SecureStorage(private val context: Context) {

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "agentmoataz_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun storeSecret(ref: String, value: String) {
        prefs.edit().putString(sanitize(ref), value).apply()
    }

    /** Returns null when the ref is unknown — callers map this to SECRET_UNAVAILABLE. */
    fun resolveSecret(ref: String): String? =
        prefs.getString(sanitize(ref), null)

    fun deleteSecret(ref: String) {
        prefs.edit().remove(sanitize(ref)).apply()
    }

    private fun sanitize(ref: String): String = "secret_" + ref.replace(Regex("[^\\w.-]"), "_")
}
