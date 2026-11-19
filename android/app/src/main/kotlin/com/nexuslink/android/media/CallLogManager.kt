package com.nexuslink.android.media

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CallLog
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.serialization.Serializable

@Serializable
data class CallLogEntryDto(
    val id: Long,
    val number: String,
    val contactName: String,
    val callType: String,
    val dateMs: Long,
    val durationSec: Long
)

@Serializable
data class CallDialRequest(
    val number: String
)

sealed class CallOpResult<out T> {
    data class Success<T>(val value: T) : CallOpResult<T>()
    data class Error(val httpStatus: Int, val message: String) : CallOpResult<Nothing>()
}

/**
 * Moteur d'accès au journal d'appels Android (CallLog.Calls) et de lancement d'appel
 * depuis le PC connecté.
 */
class CallLogManager(private val context: Context) {

    fun hasReadCallLogPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) ==
            PackageManager.PERMISSION_GRANTED

    fun hasCallPhonePermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) ==
            PackageManager.PERMISSION_GRANTED

    fun listCalls(limit: Int = DEFAULT_CALLS_LIMIT): CallOpResult<List<CallLogEntryDto>> {
        if (!hasReadCallLogPermission()) {
            return CallOpResult.Error(
                403,
                "Activez la permission « Journal d'appels » dans l'application Android NexusLink."
            )
        }

        val safeLimit = limit.coerceIn(1, 200)
        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )

        val entries = ArrayList<CallLogEntryDto>(safeLimit)
        try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                null,
                null,
                "${CallLog.Calls.DATE} DESC"
            )?.use { cursor ->
                val idIdx = cursor.getColumnIndexOrThrow(CallLog.Calls._ID)
                val numberIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
                val durationIdx = cursor.getColumnIndex(CallLog.Calls.DURATION)

                while (cursor.moveToNext() && entries.size < safeLimit) {
                    val id = cursor.getLong(idIdx)
                    val number = if (numberIdx >= 0) {
                        cursor.getString(numberIdx)?.trim().orEmpty()
                    } else {
                        ""
                    }
                    val cachedName = if (nameIdx >= 0) {
                        cursor.getString(nameIdx)?.trim().orEmpty()
                    } else {
                        ""
                    }
                    val rawType = if (typeIdx >= 0) cursor.getInt(typeIdx) else CallLog.Calls.INCOMING_TYPE
                    val callType = when (rawType) {
                        CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                        CallLog.Calls.MISSED_TYPE -> "MISSED"
                        CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> "REJECTED"
                        else -> "INCOMING"
                    }
                    val dateMs = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
                    val durationSec = if (durationIdx >= 0) {
                        cursor.getLong(durationIdx).coerceAtLeast(0L)
                    } else {
                        0L
                    }

                    val displayNumber = number.ifEmpty { "Numéro masqué" }
                    entries.add(
                        CallLogEntryDto(
                            id = id,
                            number = displayNumber,
                            contactName = cachedName.ifEmpty { displayNumber },
                            callType = callType,
                            dateMs = dateMs,
                            durationSec = durationSec
                        )
                    )
                }
            }
        } catch (e: SecurityException) {
            return CallOpResult.Error(403, "Permission Journal d'appels refusée sur le téléphone.")
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lecture du journal d'appels", e)
            return CallOpResult.Error(500, "Impossible de lire le journal d'appels.")
        }

        return CallOpResult.Success(entries)
    }

    fun dialNumber(rawNumber: String): CallOpResult<Unit> {
        val number = rawNumber.trim()
        if (number.isEmpty() || number == "Numéro masqué") {
            return CallOpResult.Error(400, "Numéro de téléphone invalide.")
        }

        return try {
            val action = if (hasCallPhonePermission()) {
                Intent.ACTION_CALL
            } else {
                Intent.ACTION_DIAL
            }
            val intent = Intent(action, Uri.parse("tel:${Uri.encode(number)}")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            CallOpResult.Success(Unit)
        } catch (e: SecurityException) {
            CallOpResult.Error(403, "Permission d'appel refusée sur le téléphone.")
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lors du lancement de l'appel vers $number", e)
            CallOpResult.Error(500, "Impossible de lancer l'appel : ${e.localizedMessage ?: "erreur inconnue"}")
        }
    }

    companion object {
        private const val TAG = "CallLogManager"
        private const val DEFAULT_CALLS_LIMIT = 100
    }
}
