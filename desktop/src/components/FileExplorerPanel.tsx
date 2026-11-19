import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  HardDrive,
  Loader2,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  FsEntryDto,
  FsListResponse,
  FsStorageInfoDto,
} from "../types/protocol";

interface FileClipboardItem {
  mode: "copy" | "cut";
  entry: FsEntryDto;
}

interface FileExplorerPanelProps {
  deviceId: string | null;
  isDraggingFile: boolean;
  onRegisterDropHandler: (
    handler: ((paths: string[]) => Promise<void>) | null,
  ) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 o";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatModifiedDate(epochMs: number): string {
  if (!epochMs) return "—";
  try {
    return new Date(epochMs).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function getEntryIcon(entry: FsEntryDto) {
  if (entry.isDirectory) {
    return <Folder className="w-4 h-4 text-[#87CFF9] shrink-0" />;
  }
  const ext = entry.extension.toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic"].includes(ext)) {
    return <FileImage className="w-4 h-4 text-sky-300 shrink-0" />;
  }
  if (["mp4", "mkv", "mov", "avi", "webm", "3gp"].includes(ext)) {
    return <FileVideo className="w-4 h-4 text-purple-300 shrink-0" />;
  }
  if (["mp3", "wav", "flac", "ogg", "m4a", "aac"].includes(ext)) {
    return <FileAudio className="w-4 h-4 text-emerald-300 shrink-0" />;
  }
  if (["zip", "rar", "7z", "tar", "gz", "apk"].includes(ext)) {
    return <FileArchive className="w-4 h-4 text-amber-300 shrink-0" />;
  }
  if (
    ["json", "xml", "kt", "rs", "ts", "tsx", "js", "py", "html", "css"].includes(
      ext,
    )
  ) {
    return <FileCode className="w-4 h-4 text-cyan-300 shrink-0" />;
  }
  if (["pdf", "doc", "docx", "txt", "md", "csv", "xls", "xlsx"].includes(ext)) {
    return <FileText className="w-4 h-4 text-[#b0cadc] shrink-0" />;
  }
  return <File className="w-4 h-4 text-[#9cb1c2] shrink-0" />;
}

export function FileExplorerPanel({
  deviceId,
  isDraggingFile,
  onRegisterDropHandler,
}: FileExplorerPanelProps) {
  const [storageInfo, setStorageInfo] = useState<FsStorageInfoDto | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntryDto[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<FsEntryDto[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [loading, setLoading] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastInfo, setToastInfo] = useState<{
    text: string;
    openPath?: string;
  } | null>(null);

  const [fileClipboard, setFileClipboard] = useState<FileClipboardItem | null>(
    null,
  );

  // Modales d'action
  const [mkdirModalOpen, setMkdirModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FsEntryDto | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FsEntryDto | null>(null);

  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const searchSeqRef = useRef(0);

  const showToast = useCallback((text: string, openPath?: string) => {
    setToastInfo({ text, openPath });
  }, []);

  // Auto-fermeture du toast flottant après 3,5 s (ou 5,5 s si un bouton Ouvrir est présent)
  useEffect(() => {
    if (!toastInfo) return;
    const durationMs = toastInfo.openPath ? 5500 : 3500;
    const timer = window.setTimeout(() => {
      setToastInfo(null);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [toastInfo]);

  const loadStorageInfo = useCallback(async () => {
    try {
      const info = await invoke<FsStorageInfoDto>("fs_storage_info");
      setStorageInfo(info);
    } catch {
      // L'erreur principale est remontée par loadDirectory
    }
  }, []);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await invoke<FsListResponse>("fs_list_dir", { path });
      setCurrentPath(res.currentPath);
      setParentPath(res.parentPath);
      setEntries(res.entries);
    } catch (err) {
      setErrorMessage(
        typeof err === "string"
          ? err
          : "Impossible de lire ce dossier sur le téléphone.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const runSearch = useCallback(async (basePath: string, query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      searchSeqRef.current += 1;
      setSearchResults(null);
      setSearching(false);
      return;
    }

    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const res = await invoke<FsEntryDto[]>("fs_search_entries", {
        path: basePath,
        query: trimmed,
      });
      if (seq === searchSeqRef.current) {
        setSearchResults(res);
      }
    } catch (err) {
      if (seq === searchSeqRef.current) {
        setSearchResults([]);
        setErrorMessage(
          typeof err === "string"
            ? err
            : "Impossible d'effectuer la recherche.",
        );
      }
    } finally {
      if (seq === searchSeqRef.current) {
        setSearching(false);
      }
    }
  }, []);

  const refreshCurrentView = useCallback(
    async (targetPath?: string) => {
      const pathToLoad = targetPath ?? currentPathRef.current;
      await loadDirectory(pathToLoad);
      if (searchQueryRef.current.trim().length >= 2) {
        await runSearch(pathToLoad, searchQueryRef.current);
      }
    },
    [loadDirectory, runSearch],
  );

  useEffect(() => {
    if (!deviceId) {
      setStorageInfo(null);
      setEntries([]);
      setCurrentPath("");
      setParentPath(null);
      setFileClipboard(null);
      return;
    }
    loadStorageInfo();
    loadDirectory("");
  }, [deviceId, loadStorageInfo, loadDirectory]);

  // Enregistre le gestionnaire de glisser-déposer Windows directement dans le dossier courant
  useEffect(() => {
    if (!deviceId) {
      onRegisterDropHandler(null);
      return;
    }
    const handleDropPaths = async (paths: string[]) => {
      if (paths.length === 0) return;
      const targetDir = currentPathRef.current;
      setBusyMessage(
        `Envoi de ${paths.length} fichier${paths.length > 1 ? "s" : ""}…`,
      );
      setErrorMessage(null);
      try {
        const count = await invoke<number>("fs_upload_files", {
          targetDir,
          paths,
        });
        if (count > 0) {
          showToast(
            `${count} fichier${count > 1 ? "s envoyés" : " envoyé"} dans ${targetDir || "Stockage interne"}.`,
          );
          await refreshCurrentView(targetDir);
          loadStorageInfo();
        }
      } catch (err) {
        setErrorMessage(
          typeof err === "string"
            ? err
            : "Erreur lors de l'envoi des fichiers.",
        );
      } finally {
        setBusyMessage(null);
      }
    };

    onRegisterDropHandler(handleDropPaths);
    return () => onRegisterDropHandler(null);
  }, [deviceId, onRegisterDropHandler, refreshCurrentView, loadStorageInfo, showToast]);

  // Recherche récursive (fichiers ET dossiers) avec debounce de 280 ms dès 2 caractères
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!deviceId || trimmed.length < 2) {
      searchSeqRef.current += 1;
      setSearchResults(null);
      setSearching(false);
      return;
    }

    const timer = window.setTimeout(() => {
      runSearch(currentPath, trimmed);
    }, 280);

    return () => window.clearTimeout(timer);
  }, [deviceId, currentPath, searchQuery, runSearch]);

  const isGlobalSearchActive = searchQuery.trim().length >= 2;

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    if (q.length >= 2 && searchResults !== null) {
      return searchResults;
    }
    return entries.filter((entry) => entry.name.toLowerCase().includes(q));
  }, [entries, searchQuery, searchResults]);

  const breadcrumbs = useMemo(() => {
    const segments: { label: string; path: string }[] = [
      { label: "Stockage interne", path: "" },
    ];
    if (!currentPath) return segments;
    const parts = currentPath.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      segments.push({ label: part, path: acc });
    }
    return segments;
  }, [currentPath]);

  const handleDownload = async (entry: FsEntryDto, openAfter = false) => {
    if (entry.isDirectory) return;
    setBusyMessage(`Téléchargement de ${entry.name}…`);
    setErrorMessage(null);
    try {
      const savedPath = await invoke<string>("fs_download_file", {
        path: entry.path,
        displayName: entry.name,
      });
      if (openAfter) {
        await invoke("open_local_file", { path: savedPath });
      } else {
        showToast(`${entry.name} enregistré dans Téléchargements/NexusLink.`, savedPath);
      }
    } catch (err) {
      setErrorMessage(
        typeof err === "string"
          ? err
          : "Impossible de télécharger ce fichier.",
      );
    } finally {
      setBusyMessage(null);
    }
  };

  const handlePickAndUpload = async () => {
    setBusyMessage("Sélection et envoi de fichiers…");
    setErrorMessage(null);
    try {
      const count = await invoke<number>("fs_pick_and_upload_files", {
        targetDir: currentPath,
      });
      if (count > 0) {
        showToast(
          `${count} fichier${count > 1 ? "s envoyés" : " envoyé"} dans ${currentPath || "Stockage interne"}.`,
        );
        await refreshCurrentView(currentPath);
        loadStorageInfo();
      }
    } catch (err) {
      setErrorMessage(
        typeof err === "string"
          ? err
          : "Impossible d'envoyer les fichiers.",
      );
    } finally {
      setBusyMessage(null);
    }
  };

  const handleCreateDir = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setBusyMessage(`Création du dossier ${trimmed}…`);
    setErrorMessage(null);
    try {
      await invoke<FsEntryDto>("fs_create_dir", {
        parentPath: currentPath,
        name: trimmed,
      });
      setMkdirModalOpen(false);
      setNewFolderName("");
      await refreshCurrentView(currentPath);
    } catch (err) {
      setErrorMessage(
        typeof err === "string" ? err : "Impossible de créer le dossier.",
      );
    } finally {
      setBusyMessage(null);
    }
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const target = renameTarget;
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === target.name) {
      setRenameTarget(null);
      return;
    }
    setBusyMessage(`Renommage en ${trimmed}…`);
    setErrorMessage(null);
    try {
      const updated = await invoke<FsEntryDto>("fs_rename_entry", {
        path: target.path,
        newName: trimmed,
      });
      const oldPrefix = `${target.path}/`;
      const newPrefix = `${updated.path}/`;
      const applyRename = (list: FsEntryDto[]) =>
        list.map((item) => {
          if (item.path === target.path) return updated;
          if (target.isDirectory && item.path.startsWith(oldPrefix)) {
            return {
              ...item,
              path: newPrefix + item.path.slice(oldPrefix.length),
            };
          }
          return item;
        });

      setEntries((prev) => applyRename(prev));
      setSearchResults((prev) => (prev ? applyRename(prev) : prev));
      setRenameTarget(null);
      showToast(`Renommé en « ${updated.name} ».`);
    } catch (err) {
      setErrorMessage(
        typeof err === "string" ? err : "Impossible de renommer cet élément.",
      );
    } finally {
      setBusyMessage(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyMessage(`Suppression de ${target.name}…`);
    setErrorMessage(null);
    try {
      await invoke("fs_delete_entry", { path: target.path });
      const deletedPrefix = `${target.path}/`;
      const keepEntry = (item: FsEntryDto) =>
        item.path !== target.path && !item.path.startsWith(deletedPrefix);

      setEntries((prev) => prev.filter(keepEntry));
      setSearchResults((prev) => (prev ? prev.filter(keepEntry) : prev));
      if (
        fileClipboard &&
        (fileClipboard.entry.path === target.path ||
          fileClipboard.entry.path.startsWith(deletedPrefix))
      ) {
        setFileClipboard(null);
      }
      setDeleteTarget(null);
      showToast(`« ${target.name} » supprimé.`);
      loadStorageInfo();
    } catch (err) {
      setDeleteTarget(null);
      setErrorMessage(
        typeof err === "string" ? err : "Impossible de supprimer cet élément.",
      );
    } finally {
      setBusyMessage(null);
    }
  };

  const handlePasteHere = async () => {
    if (!fileClipboard) return;
    const isCut = fileClipboard.mode === "cut";
    setBusyMessage(
      isCut
        ? `Déplacement de ${fileClipboard.entry.name}…`
        : `Copie de ${fileClipboard.entry.name}…`,
    );
    setErrorMessage(null);
    try {
      await invoke<FsEntryDto>(isCut ? "fs_move_entry" : "fs_copy_entry", {
        sourcePath: fileClipboard.entry.path,
        targetDir: currentPath,
      });
      if (isCut) {
        setFileClipboard(null);
      }
      showToast(
        isCut
          ? `${fileClipboard.entry.name} déplacé ici.`
          : `${fileClipboard.entry.name} copié ici.`,
      );
      await refreshCurrentView(currentPath);
      loadStorageInfo();
    } catch (err) {
      setErrorMessage(
        typeof err === "string" ? err : "Opération impossible dans ce dossier.",
      );
    } finally {
      setBusyMessage(null);
    }
  };

  const usedPercent =
    storageInfo && storageInfo.totalBytes > 0
      ? Math.min(
          100,
          Math.round((storageInfo.usedBytes / storageInfo.totalBytes) * 100),
        )
      : 0;

  return (
    <div className="h-full flex gap-4 min-h-0 relative">
      {/* Overlay visuel lors d'un glisser-déposer Windows */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-30 rounded-2xl border-2 border-dashed border-[#87CFF9] bg-[#005C7D]/30 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-8 h-8 text-[#87CFF9]" />
          <p className="text-[14px] font-semibold text-[#f2f5f8]">
            Déposez vos fichiers pour les envoyer ici
          </p>
          <p className="text-[12px] text-[#d6e4ee]">
            Destination : {currentPath || "Stockage interne"}
          </p>
        </div>
      )}

      {/* Colonne gauche : Raccourcis + Espace de stockage */}
      <aside className="w-[200px] shrink-0 flex flex-col justify-between gap-4 border-r border-white/[0.07] pr-3">
        <div className="space-y-1 overflow-y-auto">
          <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#788896]">
            Accès rapide
          </div>
          {(storageInfo?.shortcuts ?? [{ label: "Stockage interne", path: "" }]).map(
            (shortcut) => {
              const isActive = currentPath === shortcut.path;
              return (
                <button
                  key={shortcut.path || "root"}
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    loadDirectory(shortcut.path);
                  }}
                  className={`relative w-full h-8 px-2.5 rounded-lg flex items-center gap-2 text-[12.5px] transition cursor-pointer ${
                    isActive
                      ? "bg-white/[0.08] text-[#f2f5f8] font-medium"
                      : "text-[#b0cadc] hover:text-[#f2f5f8] hover:bg-white/[0.04]"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[#87CFF9]" />
                  )}
                  {shortcut.path === "" ? (
                    <HardDrive className="w-3.5 h-3.5 text-[#87CFF9] shrink-0" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 text-[#87CFF9] shrink-0" />
                  )}
                  <span className="truncate">{shortcut.label}</span>
                </button>
              );
            },
          )}
        </div>

        {/* Jauge d'espace de stockage Android */}
        {storageInfo && storageInfo.totalBytes > 0 && (
          <div className="rounded-xl bg-[#14171c]/80 border border-white/[0.07] p-3 space-y-2 shrink-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#b0cadc] font-medium">Stockage</span>
              <span className="font-mono-tabular text-[#87CFF9]">
                {usedPercent}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#87CFF9] transition-all"
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <div className="text-[10.5px] text-[#788896]">
              {formatBytes(storageInfo.freeBytes)} libres sur{" "}
              {formatBytes(storageInfo.totalBytes)}
            </div>
          </div>
        )}
      </aside>

      {/* Zone droite : Barre d'outils + Liste détaillée */}
      <section className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
        {/* Ligne 1 : Retour parent + Fil d'Ariane + Recherche */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <button
              type="button"
              disabled={parentPath === null || loading}
              onClick={() => {
                if (parentPath !== null) {
                  setSearchQuery("");
                  loadDirectory(parentPath);
                }
              }}
              title="Dossier parent"
              className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] disabled:opacity-35 text-[#d6e4ee] flex items-center justify-center transition cursor-pointer shrink-0"
            >
              <ArrowUp className="w-4 h-4 text-[#87CFF9]" />
            </button>

            <div className="flex items-center gap-1 min-w-0 overflow-x-auto rounded-lg bg-[#14171c]/80 border border-white/[0.07] px-2.5 h-8 flex-1">
              {breadcrumbs.map((crumb, idx) => (
                <div
                  key={crumb.path || "root"}
                  className="flex items-center gap-1 shrink-0"
                >
                  {idx > 0 && (
                    <ChevronRight className="w-3.5 h-3.5 text-[#788896]" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      loadDirectory(crumb.path);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[12px] transition cursor-pointer ${
                      idx === breadcrumbs.length - 1
                        ? "text-[#f2f5f8] font-medium"
                        : "text-[#9cb1c2] hover:text-[#87CFF9] hover:bg-white/[0.05]"
                    }`}
                  >
                    {crumb.label}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="relative w-60 shrink-0">
            {searching ? (
              <Loader2 className="w-3.5 h-3.5 text-[#87CFF9] animate-spin absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            ) : (
              <Search className="w-3.5 h-3.5 text-[#788896] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            )}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher fichiers et dossiers…"
              className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-[#14171c] border border-white/[0.08] text-[12px] text-[#f2f5f8] placeholder:text-[#788896] focus:outline-none focus:border-[#87CFF9]/60"
            />
          </div>
        </div>

        {/* Ligne 2 : Barre d'actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setNewFolderName("");
                setMkdirModalOpen(true);
              }}
              className="h-8 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[12px] text-[#d6e4ee] flex items-center gap-1.5 transition cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#87CFF9]" />
              Nouveau dossier
            </button>

            <button
              type="button"
              onClick={handlePickAndUpload}
              disabled={busyMessage !== null}
              className="h-8 px-3 rounded-lg bg-[#005C7D] hover:bg-[#00719a] disabled:opacity-50 text-[12px] text-[#f2f5f8] font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-[#87CFF9]" />
              Envoyer ici
            </button>

            {fileClipboard && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePasteHere}
                  disabled={busyMessage !== null}
                  className="h-8 px-3 rounded-lg bg-[#005C7D]/70 hover:bg-[#005C7D] border border-[#87CFF9]/35 text-[12px] text-[#f2f5f8] font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-[#87CFF9]" />
                  Coller « {fileClipboard.entry.name} »
                </button>
                <button
                  type="button"
                  onClick={() => setFileClipboard(null)}
                  className="h-8 px-2 rounded-lg text-[11px] text-[#9cb1c2] hover:text-[#f2f5f8] hover:bg-white/[0.06] cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {busyMessage && (
              <span className="text-[11.5px] text-[#87CFF9] flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {busyMessage}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                refreshCurrentView(currentPath);
                loadStorageInfo();
              }}
              disabled={loading || searching}
              className="h-8 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[12px] text-[#d6e4ee] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#87CFF9] ${loading || searching ? "animate-spin" : ""}`}
              />
              Actualiser
            </button>
          </div>
        </div>

        {/* Erreurs éventuelles */}
        {errorMessage && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 px-3.5 py-2.5 text-[12px] text-rose-200 flex items-center justify-between gap-3 shrink-0">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-[11px] text-rose-300 hover:underline cursor-pointer shrink-0"
            >
              Fermer
            </button>
          </div>
        )}

        {/* Tableau Liste détaillée façon Explorateur Windows 11 */}
        <div className="flex-1 min-h-0 rounded-xl bg-[#14171c]/70 border border-white/[0.07] flex flex-col overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_96px_150px] gap-2 px-3.5 py-2 border-b border-white/[0.07] text-[11px] font-semibold uppercase tracking-wider text-[#788896] shrink-0">
            <span>Nom</span>
            <span>Modifié le</span>
            <span className="text-right">Taille</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
            {loading && entries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-[#9cb1c2] py-12">
                <Loader2 className="w-5 h-5 animate-spin text-[#87CFF9]" />
                <span className="text-[12.5px]">Lecture du dossier…</span>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-1.5 text-[#788896] py-12">
                <Folder className="w-7 h-7 text-[#87CFF9]/40" />
                <span className="text-[12.5px] text-[#b0cadc]">
                  {searchQuery.trim()
                    ? "Aucun élément ne correspond à ce filtre."
                    : "Ce dossier est vide."}
                </span>
              </div>
            ) : (
              filteredEntries.map((entry) => {
                const isCutItem =
                  fileClipboard?.mode === "cut" &&
                  fileClipboard.entry.path === entry.path;

                return (
                  <div
                    key={entry.path}
                    onDoubleClick={() => {
                      if (entry.isDirectory) {
                        setSearchQuery("");
                        loadDirectory(entry.path);
                      } else {
                        handleDownload(entry, true);
                      }
                    }}
                    className={`group grid grid-cols-[1fr_140px_96px_150px] gap-2 items-center px-3.5 py-2 text-[12.5px] hover:bg-white/[0.05] transition select-none ${
                      isCutItem ? "opacity-50" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (entry.isDirectory) {
                          setSearchQuery("");
                          loadDirectory(entry.path);
                        }
                      }}
                      className={`flex items-center gap-2.5 min-w-0 text-left ${
                        entry.isDirectory ? "cursor-pointer" : "cursor-default"
                      }`}
                    >
                      {getEntryIcon(entry)}
                      <div className="min-w-0">
                        <div className="text-[#f2f5f8] truncate">
                          {entry.name}
                        </div>
                        {isGlobalSearchActive && (
                          <div className="text-[10.5px] text-[#788896] truncate">
                            {entry.path.includes("/")
                              ? entry.path.slice(0, entry.path.lastIndexOf("/"))
                              : "Stockage interne"}
                          </div>
                        )}
                      </div>
                    </button>

                    <span className="text-[11.5px] text-[#788896] font-mono-tabular truncate">
                      {formatModifiedDate(entry.lastModified)}
                    </span>

                    <span className="text-[11.5px] text-[#9cb1c2] font-mono-tabular text-right">
                      {entry.isDirectory
                        ? `${entry.childCount} élém.`
                        : formatBytes(entry.size)}
                    </span>

                    <div className="flex items-center justify-end gap-0.5 opacity-80 group-hover:opacity-100">
                      {!entry.isDirectory && (
                        <button
                          type="button"
                          onClick={() => handleDownload(entry, false)}
                          title="Télécharger sur le PC"
                          className="w-7 h-7 rounded-md hover:bg-white/[0.1] text-[#87CFF9] flex items-center justify-center transition cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRenameTarget(entry);
                          setRenameDraft(entry.name);
                        }}
                        title="Renommer"
                        className="w-7 h-7 rounded-md hover:bg-white/[0.1] text-[#b0cadc] hover:text-[#f2f5f8] flex items-center justify-center transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFileClipboard({ mode: "copy", entry })
                        }
                        title="Copier"
                        className="w-7 h-7 rounded-md hover:bg-white/[0.1] text-[#b0cadc] hover:text-[#f2f5f8] flex items-center justify-center transition cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setFileClipboard({ mode: "cut", entry })}
                        title="Couper (Déplacer)"
                        className="w-7 h-7 rounded-md hover:bg-white/[0.1] text-[#b0cadc] hover:text-[#f2f5f8] flex items-center justify-center transition cursor-pointer"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(entry)}
                        title="Supprimer"
                        className="w-7 h-7 rounded-md hover:bg-rose-500/20 text-rose-300 flex items-center justify-center transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-3.5 py-1.5 border-t border-white/[0.06] text-[11px] text-[#788896] flex items-center justify-between shrink-0">
            <span>
              {filteredEntries.length} élément
              {filteredEntries.length > 1 ? "s" : ""}
            </span>
            <span>
              Double-clic : ouvrir • Glissez-déposez un fichier pour l&apos;envoyer
              ici
            </span>
          </div>
        </div>
      </section>

      {/* Modale Nouveau dossier */}
      {mkdirModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setMkdirModalOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateDir();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-5 space-y-4"
          >
            <h3 className="text-[14px] font-semibold text-[#f2f5f8]">
              Nouveau dossier
            </h3>
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Nom du dossier…"
              className="w-full h-9 px-3 rounded-lg bg-[#14171c] border border-white/[0.12] text-[13px] text-[#f2f5f8] focus:outline-none focus:border-[#87CFF9]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMkdirModalOpen(false)}
                className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[12px] text-[#d6e4ee] cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="h-8 px-3.5 rounded-lg bg-[#005C7D] hover:bg-[#00719a] disabled:opacity-40 text-[12px] font-medium text-[#f2f5f8] cursor-pointer"
              >
                Créer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale Renommer */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setRenameTarget(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRenameSubmit();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-5 space-y-4"
          >
            <h3 className="text-[14px] font-semibold text-[#f2f5f8]">
              Renommer
            </h3>
            <input
              type="text"
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#14171c] border border-white/[0.12] text-[13px] text-[#f2f5f8] focus:outline-none focus:border-[#87CFF9]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[12px] text-[#d6e4ee] cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!renameDraft.trim()}
                className="h-8 px-3.5 rounded-lg bg-[#005C7D] hover:bg-[#00719a] disabled:opacity-40 text-[12px] font-medium text-[#f2f5f8] cursor-pointer"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale Confirmation suppression */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-[14px] font-semibold text-[#f2f5f8]">
                  Supprimer du téléphone ?
                </h3>
                <p className="text-[12px] text-[#b0cadc] break-all">
                  <strong className="text-[#f2f5f8]">
                    {deleteTarget.name}
                  </strong>{" "}
                  {deleteTarget.isDirectory
                    ? "et tout son contenu seront supprimés définitivement."
                    : "sera supprimé définitivement."}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[12px] text-[#d6e4ee] cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="h-8 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-[12px] font-medium text-white cursor-pointer"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast flottant de succès (quand l'application est à l'écran) */}
      {toastInfo && (
        <div className="fixed bottom-5 right-5 z-40 max-w-sm rounded-xl bg-[#1b2028]/95 border border-emerald-500/35 shadow-2xl backdrop-blur-md px-3.5 py-2.5 flex items-center gap-2.5 text-[12.5px] text-[#f2f5f8]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{toastInfo.text}</span>
          {toastInfo.openPath && (
            <button
              type="button"
              onClick={() =>
                invoke("open_local_file", { path: toastInfo.openPath })
              }
              className="px-2 py-0.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-[11px] text-emerald-200 font-medium flex items-center gap-1 cursor-pointer shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              Ouvrir
            </button>
          )}
        </div>
      )}
    </div>
  );
}
