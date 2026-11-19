package com.nexuslink.android.media

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.util.LruCache
import android.util.Size
import kotlinx.serialization.Serializable
import java.io.ByteArrayOutputStream

/**
 * Résumé d'un dossier (album) contenant des photos et/ou vidéos sur le téléphone.
 */
@Serializable
data class MediaFolderDto(
    val bucketId: String,
    val name: String,
    val itemCount: Int,
    val photoCount: Int,
    val videoCount: Int,
    val coverMediaId: Long,
    val coverMediaType: String,
    val latestDateAdded: Long
)

/**
 * Élément média (photo ou vidéo) exposé par MediaStore.
 */
@Serializable
data class MediaItemDto(
    val id: Long,
    val mediaType: String,
    val displayName: String,
    val mimeType: String,
    val size: Long,
    val dateAdded: Long,
    val width: Int,
    val height: Int,
    val durationMs: Long,
    val bucketId: String,
    val bucketName: String
)

/**
 * Réponse paginée pour la liste des médias récents ou d'un dossier.
 */
@Serializable
data class MediaPageResponse(
    val items: List<MediaItemDto>,
    val total: Int,
    val offset: Int,
    val limit: Int,
    val hasMore: Boolean
)

/**
 * Descripteur interne pour streamer ou télécharger un fichier média original.
 */
data class MediaFileInfo(
    val uri: Uri,
    val displayName: String,
    val mimeType: String,
    val size: Long
)

/**
 * Résultat d'une demande de suppression d'un média dans MediaStore.
 */
enum class DeleteMediaResult {
    DELETED,
    NOT_FOUND,
    PERMISSION_REQUIRED,
    ERROR
}

/**
 * Moteur léger d'accès à MediaStore (images + vidéos) avec cache mémoire borné
 * pour les miniatures 256x256 JPEG.
 */
class MediaLibraryManager(private val context: Context) {

    private class FolderAccumulator(
        val bucketId: String,
        var name: String,
        var photoCount: Int = 0,
        var videoCount: Int = 0,
        var coverMediaId: Long = 0L,
        var coverMediaType: String = MEDIA_TYPE_IMAGE,
        var latestDateAdded: Long = 0L
    )

    // Cache mémoire borné à 8 Mo (~600 à 800 miniatures JPEG de 10 Ko)
    private val thumbnailCache = object : LruCache<String, ByteArray>(THUMBNAIL_CACHE_MAX_BYTES) {
        override fun sizeOf(key: String, value: ByteArray): Int = value.size
    }

    /**
     * Liste tous les dossiers (albums) contenant au moins une photo ou une vidéo,
     * triés par activité la plus récente.
     */
    fun listFolders(): List<MediaFolderDto> {
        val folders = LinkedHashMap<String, FolderAccumulator>()

        scanFoldersForUri(
            uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            mediaType = MEDIA_TYPE_IMAGE,
            target = folders
        )
        scanFoldersForUri(
            uri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            mediaType = MEDIA_TYPE_VIDEO,
            target = folders
        )

        return folders.values
            .map { acc ->
                MediaFolderDto(
                    bucketId = acc.bucketId,
                    name = acc.name,
                    itemCount = acc.photoCount + acc.videoCount,
                    photoCount = acc.photoCount,
                    videoCount = acc.videoCount,
                    coverMediaId = acc.coverMediaId,
                    coverMediaType = acc.coverMediaType,
                    latestDateAdded = acc.latestDateAdded
                )
            }
            .sortedByDescending { it.latestDateAdded }
    }

    /**
     * Retourne une page de médias (photos + vidéos) triés du plus récent au plus ancien.
     * Si [bucketId] est fourni, filtre uniquement sur ce dossier.
     */
    fun listMediaItems(
        bucketId: String? = null,
        limit: Int = DEFAULT_PAGE_LIMIT,
        offset: Int = 0
    ): MediaPageResponse {
        val safeLimit = limit.coerceIn(1, MAX_PAGE_LIMIT)
        val safeOffset = offset.coerceAtLeast(0)
        val normalizedBucket = bucketId?.takeIf { it.isNotBlank() }

        val allItems = ArrayList<MediaItemDto>(safeLimit * 2)
        queryMediaForUri(
            uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            mediaType = MEDIA_TYPE_IMAGE,
            bucketId = normalizedBucket,
            isVideo = false,
            output = allItems
        )
        queryMediaForUri(
            uri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            mediaType = MEDIA_TYPE_VIDEO,
            bucketId = normalizedBucket,
            isVideo = true,
            output = allItems
        )

        allItems.sortWith(
            compareByDescending<MediaItemDto> { it.dateAdded }
                .thenByDescending { it.id }
        )

        val total = allItems.size
        val fromIndex = safeOffset.coerceAtMost(total)
        val toIndex = (safeOffset + safeLimit).coerceAtMost(total)
        val pageItems = if (fromIndex < toIndex) {
            allItems.subList(fromIndex, toIndex).toList()
        } else {
            emptyList()
        }

        return MediaPageResponse(
            items = pageItems,
            total = total,
            offset = safeOffset,
            limit = safeLimit,
            hasMore = toIndex < total
        )
    }

    /**
     * Génère (ou lit depuis le cache mémoire) une miniature JPEG 256x256 légère.
     */
    fun loadThumbnailJpeg(mediaId: Long, mediaType: String): ByteArray? {
        val normalizedType = normalizeMediaType(mediaType) ?: return null
        val cacheKey = "$normalizedType:$mediaId"
        thumbnailCache.get(cacheKey)?.let { return it }

        val bitmap = decodeThumbnailBitmap(mediaId, normalizedType) ?: return null
        return try {
            val out = ByteArrayOutputStream(16 * 1024)
            bitmap.compress(Bitmap.CompressFormat.JPEG, THUMBNAIL_JPEG_QUALITY, out)
            val bytes = out.toByteArray()
            if (bytes.isNotEmpty()) {
                thumbnailCache.put(cacheKey, bytes)
            }
            bytes
        } catch (e: Exception) {
            Log.w(TAG, "Échec compression miniature $cacheKey", e)
            null
        } finally {
            bitmap.recycle()
        }
    }

    /**
     * Récupère les métadonnées et l'URI content:// d'un fichier original pour
     * le téléchargement ou le streaming vidéo.
     */
    fun getMediaFileInfo(mediaId: Long, mediaType: String): MediaFileInfo? {
        val normalizedType = normalizeMediaType(mediaType) ?: return null
        val baseUri = if (normalizedType == MEDIA_TYPE_VIDEO) {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
        val contentUri = ContentUris.withAppendedId(baseUri, mediaId)

        val projection = arrayOf(
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE
        )

        return try {
            context.contentResolver.query(contentUri, projection, null, null, null)?.use { cursor ->
                if (!cursor.moveToFirst()) return null
                val nameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val mimeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                val sizeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE)

                val displayName = if (nameIdx >= 0) {
                    cursor.getString(nameIdx) ?: "media_$mediaId"
                } else {
                    "media_$mediaId"
                }
                val defaultMime = if (normalizedType == MEDIA_TYPE_VIDEO) "video/mp4" else "image/jpeg"
                val mimeType = if (mimeIdx >= 0) {
                    cursor.getString(mimeIdx) ?: defaultMime
                } else {
                    defaultMime
                }
                val size = if (sizeIdx >= 0) cursor.getLong(sizeIdx).coerceAtLeast(0L) else 0L

                MediaFileInfo(
                    uri = contentUri,
                    displayName = displayName,
                    mimeType = mimeType,
                    size = size
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Impossible de lire les métadonnées de $contentUri", e)
            null
        }
    }

    fun clearCache() {
        thumbnailCache.evictAll()
    }

    /**
     * Supprime directement une photo ou une vidéo du stockage Android via MediaStore.
     * Requiert la permission « Accès à tous les fichiers » (MANAGE_EXTERNAL_STORAGE) sur Android 11+.
     */
    fun deleteMedia(mediaId: Long, mediaType: String): DeleteMediaResult {
        val normalizedType = normalizeMediaType(mediaType) ?: return DeleteMediaResult.NOT_FOUND

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            return DeleteMediaResult.PERMISSION_REQUIRED
        }

        val baseUri = if (normalizedType == MEDIA_TYPE_VIDEO) {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
        val contentUri = ContentUris.withAppendedId(baseUri, mediaId)

        return try {
            val rowsDeleted = context.contentResolver.delete(contentUri, null, null)
            thumbnailCache.remove("$normalizedType:$mediaId")
            if (rowsDeleted > 0) {
                DeleteMediaResult.DELETED
            } else {
                DeleteMediaResult.NOT_FOUND
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Permission insuffisante pour supprimer $contentUri", e)
            DeleteMediaResult.PERMISSION_REQUIRED
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lors de la suppression de $contentUri", e)
            DeleteMediaResult.ERROR
        }
    }

    private fun scanFoldersForUri(
        uri: Uri,
        mediaType: String,
        target: MutableMap<String, FolderAccumulator>
    ) {
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.BUCKET_ID,
            MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
            MediaStore.MediaColumns.DATE_ADDED
        )

        try {
            context.contentResolver.query(
                uri,
                projection,
                null,
                null,
                "${MediaStore.MediaColumns.DATE_ADDED} DESC"
            )?.use { cursor ->
                val idIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val bucketIdIdx = cursor.getColumnIndex(MediaStore.MediaColumns.BUCKET_ID)
                val bucketNameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME)
                val dateIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)

                while (cursor.moveToNext()) {
                    val mediaId = cursor.getLong(idIdx)
                    val bucketId = if (bucketIdIdx >= 0) {
                        cursor.getString(bucketIdIdx) ?: "unknown"
                    } else {
                        "unknown"
                    }
                    val bucketName = if (bucketNameIdx >= 0) {
                        cursor.getString(bucketNameIdx)?.takeIf { it.isNotBlank() } ?: "Autres"
                    } else {
                        "Autres"
                    }
                    val dateAdded = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L

                    val acc = target.getOrPut(bucketId) {
                        FolderAccumulator(bucketId = bucketId, name = bucketName)
                    }
                    if (mediaType == MEDIA_TYPE_VIDEO) {
                        acc.videoCount += 1
                    } else {
                        acc.photoCount += 1
                    }
                    if (dateAdded >= acc.latestDateAdded) {
                        acc.latestDateAdded = dateAdded
                        acc.coverMediaId = mediaId
                        acc.coverMediaType = mediaType
                        if (acc.name == "Autres" && bucketName != "Autres") {
                            acc.name = bucketName
                        }
                    }
                }
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Permission manquante pour lire $uri")
        } catch (e: Exception) {
            Log.w(TAG, "Erreur lors du scan des dossiers sur $uri", e)
        }
    }

    private fun queryMediaForUri(
        uri: Uri,
        mediaType: String,
        bucketId: String?,
        isVideo: Boolean,
        output: MutableList<MediaItemDto>
    ) {
        val projection = if (isVideo) {
            arrayOf(
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.MIME_TYPE,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.DATE_ADDED,
                MediaStore.MediaColumns.WIDTH,
                MediaStore.MediaColumns.HEIGHT,
                MediaStore.MediaColumns.BUCKET_ID,
                MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
                MediaStore.Video.VideoColumns.DURATION
            )
        } else {
            arrayOf(
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.MIME_TYPE,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.DATE_ADDED,
                MediaStore.MediaColumns.WIDTH,
                MediaStore.MediaColumns.HEIGHT,
                MediaStore.MediaColumns.BUCKET_ID,
                MediaStore.MediaColumns.BUCKET_DISPLAY_NAME
            )
        }

        val selection = if (bucketId != null) "${MediaStore.MediaColumns.BUCKET_ID} = ?" else null
        val selectionArgs = if (bucketId != null) arrayOf(bucketId) else null

        try {
            context.contentResolver.query(
                uri,
                projection,
                selection,
                selectionArgs,
                "${MediaStore.MediaColumns.DATE_ADDED} DESC"
            )?.use { cursor ->
                val idIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val mimeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                val sizeIdx = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val dateIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)
                val widthIdx = cursor.getColumnIndex(MediaStore.MediaColumns.WIDTH)
                val heightIdx = cursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT)
                val bucketIdIdx = cursor.getColumnIndex(MediaStore.MediaColumns.BUCKET_ID)
                val bucketNameIdx = cursor.getColumnIndex(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME)
                val durationIdx = if (isVideo) {
                    cursor.getColumnIndex(MediaStore.Video.VideoColumns.DURATION)
                } else {
                    -1
                }

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idIdx)
                    val displayName = if (nameIdx >= 0) {
                        cursor.getString(nameIdx) ?: "media_$id"
                    } else {
                        "media_$id"
                    }
                    val defaultMime = if (isVideo) "video/mp4" else "image/jpeg"
                    val mimeType = if (mimeIdx >= 0) {
                        cursor.getString(mimeIdx) ?: defaultMime
                    } else {
                        defaultMime
                    }
                    val size = if (sizeIdx >= 0) cursor.getLong(sizeIdx).coerceAtLeast(0L) else 0L
                    val dateAdded = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
                    val width = if (widthIdx >= 0) cursor.getInt(widthIdx) else 0
                    val height = if (heightIdx >= 0) cursor.getInt(heightIdx) else 0
                    val itemBucketId = if (bucketIdIdx >= 0) {
                        cursor.getString(bucketIdIdx) ?: "unknown"
                    } else {
                        "unknown"
                    }
                    val itemBucketName = if (bucketNameIdx >= 0) {
                        cursor.getString(bucketNameIdx)?.takeIf { it.isNotBlank() } ?: "Autres"
                    } else {
                        "Autres"
                    }
                    val durationMs = if (durationIdx >= 0) {
                        cursor.getLong(durationIdx).coerceAtLeast(0L)
                    } else {
                        0L
                    }

                    output.add(
                        MediaItemDto(
                            id = id,
                            mediaType = mediaType,
                            displayName = displayName,
                            mimeType = mimeType,
                            size = size,
                            dateAdded = dateAdded,
                            width = width,
                            height = height,
                            durationMs = durationMs,
                            bucketId = itemBucketId,
                            bucketName = itemBucketName
                        )
                    )
                }
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Permission manquante pour interroger $uri")
        } catch (e: Exception) {
            Log.w(TAG, "Erreur lors de la lecture des médias sur $uri", e)
        }
    }

    @Suppress("DEPRECATION")
    private fun decodeThumbnailBitmap(mediaId: Long, normalizedType: String): Bitmap? {
        val baseUri = if (normalizedType == MEDIA_TYPE_VIDEO) {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }
        val contentUri = ContentUris.withAppendedId(baseUri, mediaId)

        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                context.contentResolver.loadThumbnail(
                    contentUri,
                    Size(THUMBNAIL_SIZE_PX, THUMBNAIL_SIZE_PX),
                    null
                )
            } else if (normalizedType == MEDIA_TYPE_VIDEO) {
                MediaStore.Video.Thumbnails.getThumbnail(
                    context.contentResolver,
                    mediaId,
                    MediaStore.Video.Thumbnails.MINI_KIND,
                    null
                )
            } else {
                MediaStore.Images.Thumbnails.getThumbnail(
                    context.contentResolver,
                    mediaId,
                    MediaStore.Images.Thumbnails.MINI_KIND,
                    null
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Miniature indisponible pour $normalizedType:$mediaId", e)
            null
        }
    }

    private fun normalizeMediaType(raw: String): String? = when (raw.uppercase()) {
        MEDIA_TYPE_IMAGE, "PHOTO" -> MEDIA_TYPE_IMAGE
        MEDIA_TYPE_VIDEO -> MEDIA_TYPE_VIDEO
        else -> null
    }

    companion object {
        private const val TAG = "MediaLibraryManager"
        const val MEDIA_TYPE_IMAGE = "IMAGE"
        const val MEDIA_TYPE_VIDEO = "VIDEO"
        const val DEFAULT_PAGE_LIMIT = 60
        const val MAX_PAGE_LIMIT = 200
        private const val THUMBNAIL_SIZE_PX = 256
        private const val THUMBNAIL_JPEG_QUALITY = 72
        private const val THUMBNAIL_CACHE_MAX_BYTES = 8 * 1024 * 1024
    }
}
