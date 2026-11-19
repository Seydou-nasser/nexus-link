package com.nexuslink.android.media

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.util.Log
import kotlinx.serialization.Serializable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

@Serializable
data class FsShortcutDto(
    val label: String,
    val path: String
)

@Serializable
data class FsStorageInfoDto(
    val totalBytes: Long,
    val freeBytes: Long,
    val usedBytes: Long,
    val hasAllFilesAccess: Boolean,
    val shortcuts: List<FsShortcutDto>
)

@Serializable
data class FsEntryDto(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long,
    val lastModified: Long,
    val extension: String,
    val childCount: Int
)

@Serializable
data class FsListResponse(
    val currentPath: String,
    val parentPath: String?,
    val entries: List<FsEntryDto>
)

@Serializable
data class FsMkdirRequest(
    val parentPath: String = "",
    val name: String
)

@Serializable
data class FsRenameRequest(
    val path: String,
    val newName: String
)

@Serializable
data class FsTransferOpRequest(
    val sourcePath: String,
    val targetDir: String = ""
)

sealed class FsOpResult<out T> {
    data class Success<T>(val value: T) : FsOpResult<T>()
    data class Error(val httpStatus: Int, val message: String) : FsOpResult<Nothing>()
}

/**
 * Moteur d'exploration et de gestion de fichiers confiné au stockage interne Android
 * (/storage/emulated/0), protégé contre le path-traversal et sans surcharge mémoire.
 */
class FileExplorerManager(private val context: Context) {

    private val rootDir: File by lazy {
        Environment.getExternalStorageDirectory().canonicalFile
    }

    fun hasAllFilesAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            true
        }

    fun getStorageInfo(): FsStorageInfoDto {
        val stat = try {
            StatFs(rootDir.path)
        } catch (_: Exception) {
            null
        }
        val total = stat?.totalBytes ?: 0L
        val free = stat?.availableBytes ?: 0L
        val used = (total - free).coerceAtLeast(0L)

        val candidates = listOf(
            "Stockage interne" to "",
            "Téléchargements" to "Download",
            "Documents" to "Documents",
            "Appareil photo" to "DCIM",
            "Images" to "Pictures",
            "Musique" to "Music"
        )

        val shortcuts = candidates.mapNotNull { (label, relPath) ->
            if (relPath.isEmpty()) {
                FsShortcutDto(label = label, path = "")
            } else {
                val target = File(rootDir, relPath)
                if (target.exists() && target.isDirectory) {
                    FsShortcutDto(label = label, path = relPath)
                } else {
                    null
                }
            }
        }

        return FsStorageInfoDto(
            totalBytes = total,
            freeBytes = free,
            usedBytes = used,
            hasAllFilesAccess = hasAllFilesAccess(),
            shortcuts = shortcuts
        )
    }

    fun listDirectory(relativePath: String?): FsOpResult<FsListResponse> {
        if (!hasAllFilesAccess()) {
            return permissionError()
        }
        val dir = resolveConfined(relativePath)
            ?: return FsOpResult.Error(400, "Chemin invalide ou hors du stockage interne.")

        if (!dir.exists() || !dir.isDirectory) {
            return FsOpResult.Error(404, "Dossier introuvable.")
        }

        val rawChildren = dir.listFiles() ?: emptyArray()
        val entries = rawChildren
            .mapNotNull { file ->
                try {
                    val isDir = file.isDirectory
                    val relPath = toRelativePath(file) ?: return@mapNotNull null
                    val ext = if (isDir) "" else file.extension.lowercase()
                    val childCount = if (isDir) {
                        file.list()?.size ?: 0
                    } else {
                        0
                    }
                    FsEntryDto(
                        name = file.name,
                        path = relPath,
                        isDirectory = isDir,
                        size = if (isDir) 0L else file.length().coerceAtLeast(0L),
                        lastModified = file.lastModified(),
                        extension = ext,
                        childCount = childCount
                    )
                } catch (_: Exception) {
                    null
                }
            }
            .sortedWith(
                compareByDescending<FsEntryDto> { it.isDirectory }
                    .thenBy { it.name.lowercase() }
            )

        val currentRel = toRelativePath(dir) ?: ""
        val parentRel = if (currentRel.isEmpty()) {
            null
        } else {
            val lastSlash = currentRel.lastIndexOf('/')
            if (lastSlash < 0) "" else currentRel.substring(0, lastSlash)
        }

        return FsOpResult.Success(
            FsListResponse(
                currentPath = currentRel,
                parentPath = parentRel,
                entries = entries
            )
        )
    }

    fun createDirectory(parentPath: String, rawName: String): FsOpResult<FsEntryDto> {
        if (!hasAllFilesAccess()) return permissionError()
        val cleanName = sanitizeSingleName(rawName)
            ?: return FsOpResult.Error(400, "Nom de dossier invalide.")

        val parentDir = resolveConfined(parentPath)
            ?: return FsOpResult.Error(400, "Dossier parent invalide.")
        if (!parentDir.exists() || !parentDir.isDirectory) {
            return FsOpResult.Error(404, "Dossier parent introuvable.")
        }

        val target = File(parentDir, cleanName)
        if (!isInsideRoot(target)) {
            return FsOpResult.Error(400, "Chemin cible refusé.")
        }
        if (target.exists()) {
            return FsOpResult.Error(409, "Un fichier ou dossier porte déjà ce nom.")
        }

        return if (target.mkdir()) {
            val relPath = toRelativePath(target) ?: cleanName
            FsOpResult.Success(
                FsEntryDto(
                    name = target.name,
                    path = relPath,
                    isDirectory = true,
                    size = 0L,
                    lastModified = target.lastModified(),
                    extension = "",
                    childCount = 0
                )
            )
        } else {
            FsOpResult.Error(500, "Impossible de créer le dossier.")
        }
    }

    fun renameEntry(relativePath: String, rawNewName: String): FsOpResult<FsEntryDto> {
        if (!hasAllFilesAccess()) return permissionError()
        val cleanNewName = sanitizeSingleName(rawNewName)
            ?: return FsOpResult.Error(400, "Nouveau nom invalide.")

        val source = resolveConfined(relativePath)
            ?: return FsOpResult.Error(400, "Chemin source invalide.")
        if (source == rootDir) {
            return FsOpResult.Error(400, "Impossible de renommer la racine du stockage.")
        }
        if (!source.exists()) {
            return FsOpResult.Error(404, "Élément introuvable.")
        }

        val parent = source.parentFile ?: return FsOpResult.Error(400, "Parent introuvable.")
        val target = File(parent, cleanNewName)
        if (!isInsideRoot(target)) {
            return FsOpResult.Error(400, "Chemin cible refusé.")
        }
        if (target.exists() && target.canonicalFile != source.canonicalFile) {
            return FsOpResult.Error(409, "Un élément porte déjà ce nom.")
        }

        return if (source.renameTo(target)) {
            scanPath(source.absolutePath)
            scanPath(target.absolutePath)
            val isDir = target.isDirectory
            FsOpResult.Success(
                FsEntryDto(
                    name = target.name,
                    path = toRelativePath(target) ?: cleanNewName,
                    isDirectory = isDir,
                    size = if (isDir) 0L else target.length().coerceAtLeast(0L),
                    lastModified = target.lastModified(),
                    extension = if (isDir) "" else target.extension.lowercase(),
                    childCount = if (isDir) target.list()?.size ?: 0 else 0
                )
            )
        } else {
            FsOpResult.Error(500, "Impossible de renommer cet élément.")
        }
    }

    fun deleteEntry(relativePath: String): FsOpResult<Unit> {
        if (!hasAllFilesAccess()) return permissionError()
        val target = resolveConfined(relativePath)
            ?: return FsOpResult.Error(400, "Chemin invalide.")
        if (target == rootDir) {
            return FsOpResult.Error(400, "Impossible de supprimer la racine du stockage.")
        }
        if (!target.exists()) {
            return FsOpResult.Error(404, "Élément introuvable.")
        }

        val deleted = try {
            target.deleteRecursively()
        } catch (e: Exception) {
            Log.e(TAG, "Erreur suppression récursive ${target.absolutePath}", e)
            false
        }

        return if (deleted) {
            scanPath(target.absolutePath)
            FsOpResult.Success(Unit)
        } else {
            FsOpResult.Error(500, "Impossible de supprimer cet élément.")
        }
    }

    fun moveEntry(sourcePath: String, targetDirPath: String): FsOpResult<FsEntryDto> {
        if (!hasAllFilesAccess()) return permissionError()
        val source = resolveConfined(sourcePath)
            ?: return FsOpResult.Error(400, "Chemin source invalide.")
        val targetDir = resolveConfined(targetDirPath)
            ?: return FsOpResult.Error(400, "Dossier de destination invalide.")

        if (source == rootDir || !source.exists()) {
            return FsOpResult.Error(404, "Élément source introuvable.")
        }
        if (!targetDir.exists() || !targetDir.isDirectory) {
            return FsOpResult.Error(404, "Dossier de destination introuvable.")
        }
        if (source.isDirectory && isSameOrChild(targetDir, source)) {
            return FsOpResult.Error(400, "Impossible de déplacer un dossier dans lui-même.")
        }

        val destination = uniqueChildFile(targetDir, source.name)
        if (!isInsideRoot(destination)) {
            return FsOpResult.Error(400, "Destination refusée.")
        }

        val moved = if (source.renameTo(destination)) {
            true
        } else {
            try {
                copyRecursivelyStreaming(source, destination)
                source.deleteRecursively()
            } catch (e: Exception) {
                Log.e(TAG, "Erreur déplacement ${source.path} -> ${destination.path}", e)
                false
            }
        }

        return if (moved) {
            scanPath(source.absolutePath)
            scanPath(destination.absolutePath)
            val isDir = destination.isDirectory
            FsOpResult.Success(
                FsEntryDto(
                    name = destination.name,
                    path = toRelativePath(destination) ?: destination.name,
                    isDirectory = isDir,
                    size = if (isDir) 0L else destination.length().coerceAtLeast(0L),
                    lastModified = destination.lastModified(),
                    extension = if (isDir) "" else destination.extension.lowercase(),
                    childCount = if (isDir) destination.list()?.size ?: 0 else 0
                )
            )
        } else {
            FsOpResult.Error(500, "Impossible de déplacer cet élément.")
        }
    }

    fun copyEntry(sourcePath: String, targetDirPath: String): FsOpResult<FsEntryDto> {
        if (!hasAllFilesAccess()) return permissionError()
        val source = resolveConfined(sourcePath)
            ?: return FsOpResult.Error(400, "Chemin source invalide.")
        val targetDir = resolveConfined(targetDirPath)
            ?: return FsOpResult.Error(400, "Dossier de destination invalide.")

        if (source == rootDir || !source.exists()) {
            return FsOpResult.Error(404, "Élément source introuvable.")
        }
        if (!targetDir.exists() || !targetDir.isDirectory) {
            return FsOpResult.Error(404, "Dossier de destination introuvable.")
        }
        if (source.isDirectory && isSameOrChild(targetDir, source)) {
            return FsOpResult.Error(400, "Impossible de copier un dossier dans lui-même.")
        }

        val destination = uniqueChildFile(targetDir, source.name)
        if (!isInsideRoot(destination)) {
            return FsOpResult.Error(400, "Destination refusée.")
        }

        return try {
            copyRecursivelyStreaming(source, destination)
            scanPath(destination.absolutePath)
            val isDir = destination.isDirectory
            FsOpResult.Success(
                FsEntryDto(
                    name = destination.name,
                    path = toRelativePath(destination) ?: destination.name,
                    isDirectory = isDir,
                    size = if (isDir) 0L else destination.length().coerceAtLeast(0L),
                    lastModified = destination.lastModified(),
                    extension = if (isDir) "" else destination.extension.lowercase(),
                    childCount = if (isDir) destination.list()?.size ?: 0 else 0
                )
            )
        } catch (e: Exception) {
            Log.e(TAG, "Erreur copie ${source.path} -> ${destination.path}", e)
            FsOpResult.Error(500, "Impossible de copier cet élément.")
        }
    }

    fun resolveFileForDownload(relativePath: String): FsOpResult<File> {
        if (!hasAllFilesAccess()) return permissionError()
        val target = resolveConfined(relativePath)
            ?: return FsOpResult.Error(400, "Chemin invalide.")
        if (!target.exists() || !target.isFile) {
            return FsOpResult.Error(404, "Fichier introuvable.")
        }
        return FsOpResult.Success(target)
    }

    fun createUploadTargetFile(dirPath: String, rawFileName: String): FsOpResult<File> {
        if (!hasAllFilesAccess()) return permissionError()
        val cleanName = sanitizeSingleName(rawFileName)
            ?: return FsOpResult.Error(400, "Nom de fichier invalide.")
        val targetDir = resolveConfined(dirPath)
            ?: return FsOpResult.Error(400, "Dossier cible invalide.")
        if (!targetDir.exists() || !targetDir.isDirectory) {
            return FsOpResult.Error(404, "Dossier cible introuvable.")
        }
        val dest = uniqueChildFile(targetDir, cleanName)
        if (!isInsideRoot(dest)) {
            return FsOpResult.Error(400, "Chemin cible refusé.")
        }
        return FsOpResult.Success(dest)
    }

    fun notifyFileAdded(file: File) {
        scanPath(file.absolutePath)
    }

    /**
     * Recherche récursive légère (parcours en largeur) sur les fichiers ET dossiers
     * dans [basePath] et ses sous-dossiers, plafonnée pour rester instantanée.
     */
    fun searchEntries(
        basePath: String?,
        rawQuery: String,
        maxResults: Int = DEFAULT_SEARCH_MAX_RESULTS
    ): FsOpResult<List<FsEntryDto>> {
        if (!hasAllFilesAccess()) return permissionError()
        val query = rawQuery.trim().lowercase()
        if (query.isEmpty()) return FsOpResult.Success(emptyList())

        val startDir = resolveConfined(basePath)
            ?: return FsOpResult.Error(400, "Dossier de recherche invalide.")
        if (!startDir.exists() || !startDir.isDirectory) {
            return FsOpResult.Error(404, "Dossier introuvable.")
        }

        val safeLimit = maxResults.coerceIn(1, 200)
        val results = ArrayList<FsEntryDto>(safeLimit)
        val queue = ArrayDeque<File>()
        queue.add(startDir)

        var visitedCount = 0
        while (queue.isNotEmpty() && results.size < safeLimit && visitedCount < MAX_SEARCH_VISITED) {
            val dir = queue.removeFirst()
            val children = dir.listFiles() ?: continue

            for (child in children) {
                visitedCount++
                if (visitedCount > MAX_SEARCH_VISITED) break

                val relPath = toRelativePath(child) ?: continue
                // Ignore Android/data et Android/obb (lents et souvent restreints)
                if (relPath == "Android/data" || relPath == "Android/obb") continue

                val isDir = child.isDirectory
                if (child.name.lowercase().contains(query)) {
                    results.add(
                        FsEntryDto(
                            name = child.name,
                            path = relPath,
                            isDirectory = isDir,
                            size = if (isDir) 0L else child.length().coerceAtLeast(0L),
                            lastModified = child.lastModified(),
                            extension = if (isDir) "" else child.extension.lowercase(),
                            childCount = if (isDir) child.list()?.size ?: 0 else 0
                        )
                    )
                    if (results.size >= safeLimit) break
                }

                if (isDir) {
                    queue.addLast(child)
                }
            }
        }

        results.sortWith(
            compareByDescending<FsEntryDto> { it.isDirectory }
                .thenBy { it.name.lowercase() }
        )
        return FsOpResult.Success(results)
    }

    private fun permissionError(): FsOpResult.Error =
        FsOpResult.Error(
            403,
            "Activez « Gestion de la galerie » (Accès à tous les fichiers) dans l'application Android NexusLink."
        )

    private fun resolveConfined(relativePath: String?): File? {
        val cleaned = relativePath
            ?.replace('\\', '/')
            ?.trim()
            ?.trimStart('/')
            ?: ""

        val candidate = if (cleaned.isEmpty()) rootDir else File(rootDir, cleaned)
        return try {
            val canonical = candidate.canonicalFile
            if (isSameOrChild(canonical, rootDir)) canonical else null
        } catch (_: Exception) {
            null
        }
    }

    private fun isInsideRoot(file: File): Boolean = try {
        isSameOrChild(file.canonicalFile, rootDir)
    } catch (_: Exception) {
        false
    }

    private fun isSameOrChild(candidate: File, parent: File): Boolean {
        val candidatePath = candidate.canonicalPath
        val parentPath = parent.canonicalPath
        return candidatePath == parentPath || candidatePath.startsWith(parentPath + File.separator)
    }

    private fun toRelativePath(file: File): String? {
        val canonical = try {
            file.canonicalPath
        } catch (_: Exception) {
            return null
        }
        val rootPath = rootDir.canonicalPath
        if (canonical == rootPath) return ""
        val prefix = rootPath + File.separator
        if (!canonical.startsWith(prefix)) return null
        return canonical.substring(prefix.length).replace(File.separatorChar, '/')
    }

    private fun sanitizeSingleName(rawName: String): String? {
        val trimmed = rawName.trim()
        if (trimmed.isEmpty() || trimmed == "." || trimmed == "..") return null
        if (trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\u0000')) {
            return null
        }
        return trimmed
    }

    private fun uniqueChildFile(dir: File, fileName: String): File {
        val initial = File(dir, fileName)
        if (!initial.exists()) return initial

        val dotIdx = fileName.lastIndexOf('.')
        val hasExt = dotIdx > 0 && dotIdx < fileName.length - 1
        val stem = if (hasExt) fileName.substring(0, dotIdx) else fileName
        val ext = if (hasExt) fileName.substring(dotIdx) else ""

        for (index in 1..999) {
            val candidate = File(dir, "$stem ($index)$ext")
            if (!candidate.exists()) return candidate
        }
        return File(dir, "${stem}_${System.currentTimeMillis()}$ext")
    }

    private fun copyRecursivelyStreaming(source: File, destination: File) {
        if (source.isDirectory) {
            if (!destination.exists() && !destination.mkdirs()) {
                throw IllegalStateException("Impossible de créer ${destination.path}")
            }
            source.listFiles()?.forEach { child ->
                copyRecursivelyStreaming(child, File(destination, child.name))
            }
        } else {
            val buffer = ByteArray(COPY_BUFFER_SIZE)
            FileInputStream(source).use { input ->
                FileOutputStream(destination).use { output ->
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                    }
                    output.flush()
                }
            }
        }
    }

    private fun scanPath(path: String) {
        try {
            MediaScannerConnection.scanFile(context, arrayOf(path), null, null)
        } catch (_: Exception) {
        }
    }

    companion object {
        private const val TAG = "FileExplorerManager"
        private const val COPY_BUFFER_SIZE = 64 * 1024
        private const val DEFAULT_SEARCH_MAX_RESULTS = 100
        private const val MAX_SEARCH_VISITED = 8000
    }
}
