import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Film,
  Folder,
  Image as ImageIcon,
  Images,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type {
  MediaFolderDto,
  MediaItemDto,
  MediaPageResponse,
} from "../types/protocol";

type GalleryMode = "recent" | "folders";
type MediaFilter = "ALL" | "IMAGE" | "VIDEO";

const PAGE_SIZE = 60;

interface GalleryPanelProps {
  httpPort: number;
  deviceId: string | null;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatMediaSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatDateLabel(epochSeconds: number): string {
  if (!epochSeconds) return "";
  try {
    return new Date(epochSeconds * 1000).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function GalleryPanel({ httpPort, deviceId }: GalleryPanelProps) {
  const [mode, setMode] = useState<GalleryMode>("recent");
  const [filter, setFilter] = useState<MediaFilter>("ALL");
  const [selectedFolder, setSelectedFolder] = useState<MediaFolderDto | null>(
    null,
  );

  const [folders, setFolders] = useState<MediaFolderDto[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);

  const [items, setItems] = useState<MediaItemDto[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Visionneuse intégrée
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [unsupportedVideoCodec, setUnsupportedVideoCodec] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);

  const baseUrl = `http://127.0.0.1:${httpPort}`;

  const thumbUrl = (mediaType: "IMAGE" | "VIDEO", id: number) =>
    `${baseUrl}/api/v1/media/thumb/${mediaType}/${id}`;

  const fileUrl = (mediaType: "IMAGE" | "VIDEO", id: number) =>
    `${baseUrl}/api/v1/media/file/${mediaType}/${id}`;

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    setErrorMessage(null);
    try {
      const list = await invoke<MediaFolderDto[]>("get_media_folders");
      setFolders(list);
    } catch (err) {
      setErrorMessage(
        typeof err === "string"
          ? err
          : "Impossible de charger les dossiers du téléphone.",
      );
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  const loadItemsPage = useCallback(
    async (bucketId: string | null, offset: number, append: boolean) => {
      const seq = ++requestSeqRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setItemsLoading(true);
        setErrorMessage(null);
      }

      try {
        const page = await invoke<MediaPageResponse>("get_media_items", {
          bucketId,
          limit: PAGE_SIZE,
          offset,
        });
        if (seq !== requestSeqRef.current) return;

        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setTotalItems(page.total);
        setHasMore(page.hasMore);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setErrorMessage(
          typeof err === "string"
            ? err
            : "Impossible de charger les médias du téléphone.",
        );
      } finally {
        if (seq === requestSeqRef.current) {
          setItemsLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  // Chargement initial ou lors d'un changement d'appareil connecté
  useEffect(() => {
    if (!deviceId) {
      setFolders([]);
      setItems([]);
      setSelectedFolder(null);
      setViewerIndex(null);
      return;
    }

    if (mode === "folders" && !selectedFolder) {
      loadFolders();
    } else {
      loadItemsPage(selectedFolder?.bucketId ?? null, 0, false);
    }
  }, [deviceId, mode, selectedFolder, loadFolders, loadItemsPage]);

  // Liste filtrée côté client (instantané sans requête supplémentaire)
  const visibleItems = useMemo(() => {
    if (filter === "ALL") return items;
    return items.filter((item) => item.mediaType === filter);
  }, [items, filter]);

  const activeViewerItem =
    viewerIndex !== null && visibleItems[viewerIndex]
      ? visibleItems[viewerIndex]
      : null;

  // Scroll infini léger via IntersectionObserver sur le conteneur scrollable
  useEffect(() => {
    if (viewerIndex !== null) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || itemsLoading || loadingMore) return;
    if (mode === "folders" && !selectedFolder) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          loadItemsPage(selectedFolder?.bucketId ?? null, items.length, true);
        }
      },
      { root: scrollContainerRef.current, rootMargin: "320px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    viewerIndex,
    hasMore,
    itemsLoading,
    loadingMore,
    items.length,
    mode,
    selectedFolder,
    loadItemsPage,
  ]);

  // Préchargement automatique dans la visionneuse avant d'atteindre la fin du lot
  useEffect(() => {
    if (viewerIndex === null) return;
    if (!hasMore || itemsLoading || loadingMore) return;
    if (viewerIndex >= visibleItems.length - 5) {
      loadItemsPage(selectedFolder?.bucketId ?? null, items.length, true);
    }
  }, [
    viewerIndex,
    visibleItems.length,
    hasMore,
    itemsLoading,
    loadingMore,
    items.length,
    selectedFolder,
    loadItemsPage,
  ]);

  // Navigation clavier dans la visionneuse
  useEffect(() => {
    if (viewerIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setViewerIndex(null);
      } else if (e.key === "ArrowLeft") {
        setViewerIndex((prev) =>
          prev !== null && prev > 0 ? prev - 1 : prev,
        );
      } else if (e.key === "ArrowRight") {
        setViewerIndex((prev) =>
          prev !== null && prev + 1 < visibleItems.length ? prev + 1 : prev,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewerIndex, visibleItems.length]);

  // Réinitialise les retours d'action quand on change de média dans la visionneuse
  useEffect(() => {
    setDownloadedPath(null);
    setUnsupportedVideoCodec(false);
    setDeleteConfirmOpen(false);
    setDeleteError(null);
  }, [viewerIndex]);

  const handleRefresh = () => {
    if (mode === "folders" && !selectedFolder) {
      loadFolders();
    } else {
      loadItemsPage(selectedFolder?.bucketId ?? null, 0, false);
    }
  };

  const handleDownload = async (item: MediaItemDto) => {
    setDownloadingId(item.id);
    setDownloadedPath(null);
    try {
      const savedPath = await invoke<string>("download_media_to_pc", {
        mediaId: item.id,
        mediaType: item.mediaType,
        displayName: item.displayName,
      });
      setDownloadedPath(savedPath);
    } catch (err) {
      console.error("Erreur téléchargement média :", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleOpenInExternalPlayer = async (item: MediaItemDto) => {
    if (downloadedPath) {
      await invoke("open_local_file", { path: downloadedPath });
      return;
    }
    setDownloadingId(item.id);
    try {
      const savedPath = await invoke<string>("download_media_to_pc", {
        mediaId: item.id,
        mediaType: item.mediaType,
        displayName: item.displayName,
      });
      setDownloadedPath(savedPath);
      await invoke("open_local_file", { path: savedPath });
    } catch (err) {
      console.error("Erreur ouverture lecteur externe :", err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleConfirmDelete = async (item: MediaItemDto) => {
    setDeletingId(item.id);
    setDeleteError(null);
    try {
      await invoke("delete_media_on_phone", {
        mediaId: item.id,
        mediaType: item.mediaType,
      });

      const remainingVisibleCount = visibleItems.length - 1;
      setItems((prev) =>
        prev.filter(
          (entry) =>
            !(entry.id === item.id && entry.mediaType === item.mediaType),
        ),
      );
      setTotalItems((prev) => Math.max(0, prev - 1));
      setDeleteConfirmOpen(false);

      if (remainingVisibleCount <= 0) {
        setViewerIndex(null);
      } else if (viewerIndex !== null && viewerIndex >= remainingVisibleCount) {
        setViewerIndex(remainingVisibleCount - 1);
      }
    } catch (err) {
      setDeleteConfirmOpen(false);
      setDeleteError(
        typeof err === "string"
          ? err
          : "Impossible de supprimer ce fichier sur le téléphone.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const isFolderGridView = mode === "folders" && !selectedFolder;

  // Vue visionneuse intégrée au panneau (façon Mobile connecté : garde la barre latérale et les onglets visibles)
  if (activeViewerItem && viewerIndex !== null) {
    const backLabel = selectedFolder
      ? `Retour à ${selectedFolder.name}`
      : "Retour aux photos";

    return (
      <div className="h-full flex flex-col gap-3 min-h-0">
        {/* Barre supérieure de la visionneuse intégrée */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/[0.07] shrink-0">
          <button
            type="button"
            onClick={() => setViewerIndex(null)}
            title="Revenir à la grille (Échap)"
            className="h-8 px-2.5 -ml-1 rounded-lg hover:bg-white/[0.06] text-[13px] font-medium text-[#87CFF9] flex items-center gap-2 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="truncate max-w-[260px]">{backLabel}</span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenInExternalPlayer(activeViewerItem)}
              disabled={downloadingId === activeViewerItem.id}
              className="h-8 px-3 rounded-lg hover:bg-white/[0.08] text-[12.5px] text-[#f2f5f8] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#87CFF9]" />
              Ouvrir
            </button>

            <button
              type="button"
              onClick={() => handleDownload(activeViewerItem)}
              disabled={downloadingId === activeViewerItem.id}
              className={`h-8 px-3 rounded-lg text-[12.5px] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 ${
                downloadedPath
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "hover:bg-white/[0.08] text-[#f2f5f8]"
              }`}
            >
              {downloadingId === activeViewerItem.id ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#87CFF9]" />
                  Enregistrement…
                </>
              ) : downloadedPath ? (
                <>
                  <Download className="w-3.5 h-3.5 text-emerald-300" />
                  Enregistré
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-[#87CFF9]" />
                  Enregistrer sur le PC
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDeleteConfirmOpen(true);
              }}
              disabled={deletingId === activeViewerItem.id}
              className="h-8 px-3 rounded-lg hover:bg-rose-500/15 text-[12.5px] text-rose-300 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer
            </button>
          </div>
        </div>

        {/* Message d'erreur de suppression (ex. permission Accès à tous les fichiers manquante) */}
        {deleteError && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 px-4 py-2.5 text-[12px] text-rose-200 flex items-center justify-between gap-3 shrink-0">
            <span>{deleteError}</span>
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              className="text-[11px] text-rose-300 hover:underline cursor-pointer shrink-0"
            >
              Fermer
            </button>
          </div>
        )}

        {/* Zone centrale avec flèches discrètes gauche/droite */}
        <div className="flex-1 min-h-0 relative flex items-center justify-center px-12 py-2">
          {viewerIndex > 0 && (
            <button
              type="button"
              onClick={() => setViewerIndex(viewerIndex - 1)}
              title="Précédent (←)"
              className="absolute left-1 z-10 w-10 h-16 rounded-xl hover:bg-white/[0.08] text-[#d6e4ee] hover:text-white flex items-center justify-center transition cursor-pointer"
            >
              <ChevronLeft className="w-7 h-7 stroke-[1.75]" />
            </button>
          )}

          <div className="max-w-full max-h-full flex flex-col items-center justify-center gap-3 min-h-0">
            {activeViewerItem.mediaType === "VIDEO" ? (
              <>
                <video
                  key={activeViewerItem.id}
                  src={fileUrl("VIDEO", activeViewerItem.id)}
                  poster={thumbUrl("VIDEO", activeViewerItem.id)}
                  controls
                  autoPlay
                  playsInline
                  onLoadedMetadata={(e) => {
                    setUnsupportedVideoCodec(e.currentTarget.videoWidth === 0);
                  }}
                  className="min-w-[320px] max-w-full max-h-[calc(100vh-240px)] rounded-xl bg-black shadow-2xl outline-none"
                />
                {unsupportedVideoCodec && (
                  <div className="rounded-xl bg-[#232934]/95 border border-[#87CFF9]/30 px-4 py-2.5 flex flex-wrap items-center justify-center gap-3 text-[12px] text-[#d6e4ee] shadow-lg">
                    <span>
                      Codec vidéo (ex. HEVC / H.265) non pris en charge par le
                      lecteur intégré.
                    </span>
                    <button
                      type="button"
                      disabled={downloadingId === activeViewerItem.id}
                      onClick={() =>
                        handleOpenInExternalPlayer(activeViewerItem)
                      }
                      className="h-7 px-3 rounded-lg bg-[#005C7D] hover:bg-[#00719a] text-[#f2f5f8] font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#87CFF9]" />
                      {downloadingId === activeViewerItem.id
                        ? "Ouverture…"
                        : "Ouvrir dans le lecteur PC"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <img
                key={activeViewerItem.id}
                src={fileUrl("IMAGE", activeViewerItem.id)}
                alt={activeViewerItem.displayName}
                className="max-w-full max-h-[calc(100vh-225px)] rounded-xl object-contain shadow-2xl select-none"
              />
            )}
          </div>

          {viewerIndex + 1 < visibleItems.length && (
            <button
              type="button"
              onClick={() => setViewerIndex(viewerIndex + 1)}
              title="Suivant (→)"
              className="absolute right-1 z-10 w-10 h-16 rounded-xl hover:bg-white/[0.08] text-[#d6e4ee] hover:text-white flex items-center justify-center transition cursor-pointer"
            >
              <ChevronRight className="w-7 h-7 stroke-[1.75]" />
            </button>
          )}
        </div>

        {/* Pied discret : compteur + métadonnées du média */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11.5px] text-[#788896] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {activeViewerItem.mediaType === "VIDEO" ? (
              <Film className="w-3.5 h-3.5 text-[#87CFF9] shrink-0" />
            ) : (
              <ImageIcon className="w-3.5 h-3.5 text-[#87CFF9] shrink-0" />
            )}
            <span className="text-[#d6e4ee] font-medium truncate max-w-[320px]">
              {activeViewerItem.displayName}
            </span>
            <span className="truncate">
              • {activeViewerItem.bucketName} •{" "}
              {formatMediaSize(activeViewerItem.size)}
              {activeViewerItem.dateAdded > 0 &&
                ` • ${formatDateLabel(activeViewerItem.dateAdded)}`}
            </span>
          </div>

          <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] text-[#d6e4ee] font-mono-tabular text-[11px] shrink-0">
            {viewerIndex + 1} / {visibleItems.length}
          </span>
        </div>

        {/* Boîte de confirmation de suppression côté PC */}
        {deleteConfirmOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => {
              if (!deletingId) setDeleteConfirmOpen(false);
            }}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-[#1b2028] border border-white/[0.12] shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
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
                      {activeViewerItem.displayName}
                    </strong>{" "}
                    sera supprimé définitivement de votre téléphone Android.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={deletingId !== null}
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="h-8 px-3.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-[12px] text-[#d6e4ee] transition cursor-pointer disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={deletingId !== null}
                  onClick={() => handleConfirmDelete(activeViewerItem)}
                  className="h-8 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-[12px] font-medium text-white flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  {deletingId !== null && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 min-h-0">
      {/* En-tête de la galerie */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {selectedFolder ? (
            <button
              type="button"
              onClick={() => {
                setSelectedFolder(null);
                setViewerIndex(null);
              }}
              className="h-8 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-[12px] text-[#f2f5f8] flex items-center gap-1.5 transition cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[#87CFF9]" />
              Dossiers
            </button>
          ) : (
            <div className="inline-flex items-center rounded-xl bg-[#14171c] border border-white/[0.08] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("recent");
                  setSelectedFolder(null);
                  setViewerIndex(null);
                }}
                className={`h-7 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  mode === "recent"
                    ? "bg-[#005C7D] text-[#f2f5f8]"
                    : "text-[#9cb1c2] hover:text-[#f2f5f8]"
                }`}
              >
                <Images className="w-3.5 h-3.5 text-[#87CFF9]" />
                Récents
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("folders");
                  setSelectedFolder(null);
                  setViewerIndex(null);
                }}
                className={`h-7 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  mode === "folders"
                    ? "bg-[#005C7D] text-[#f2f5f8]"
                    : "text-[#9cb1c2] hover:text-[#f2f5f8]"
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-[#87CFF9]" />
                Dossiers
              </button>
            </div>
          )}

          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[#f2f5f8] truncate">
              {selectedFolder
                ? selectedFolder.name
                : mode === "folders"
                  ? "Dossiers du téléphone"
                  : "Photos & Vidéos récentes"}
            </h2>
            <p className="text-[11.5px] text-[#788896]">
              {isFolderGridView
                ? `${folders.length} dossier${folders.length > 1 ? "s" : ""}`
                : `${totalItems} élément${totalItems > 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        {/* Filtres rapides + Actualiser */}
        <div className="flex items-center gap-2">
          {!isFolderGridView && (
            <div className="inline-flex items-center rounded-lg bg-[#14171c] border border-white/[0.08] p-0.5 text-[11.5px]">
              {(
                [
                  { id: "ALL", label: "Tout" },
                  { id: "IMAGE", label: "Photos" },
                  { id: "VIDEO", label: "Vidéos" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setFilter(option.id);
                    setViewerIndex(null);
                  }}
                  className={`h-7 px-2.5 rounded-md transition cursor-pointer ${
                    filter === option.id
                      ? "bg-white/[0.1] text-[#87CFF9] font-medium"
                      : "text-[#9cb1c2] hover:text-[#f2f5f8]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleRefresh}
            disabled={itemsLoading || foldersLoading}
            title="Actualiser la galerie"
            className="h-8 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[12px] text-[#d6e4ee] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-[#87CFF9] ${
                itemsLoading || foldersLoading ? "animate-spin" : ""
              }`}
            />
            Actualiser
          </button>
        </div>
      </div>

      {/* Message d'erreur éventuel */}
      {errorMessage && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 px-4 py-3 text-[12.5px] text-rose-200 flex items-center justify-between gap-3 shrink-0">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-2.5 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-[11.5px] font-medium cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Corps scrollable : grille de dossiers OU grille de médias */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto pr-1"
      >
        {isFolderGridView ? (
          foldersLoading && folders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2.5 text-[#9cb1c2]">
              <Loader2 className="w-6 h-6 animate-spin text-[#87CFF9]" />
              <span className="text-[12.5px]">
                Chargement des dossiers du téléphone…
              </span>
            </div>
          ) : folders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-[#788896]">
              <Folder className="w-8 h-8 text-[#87CFF9]/50" />
              <p className="text-[13px] text-[#b0cadc]">
                Aucun dossier photo ou vidéo trouvé.
              </p>
              <p className="text-[11.5px] max-w-sm">
                Vérifiez que les permissions Photos et Vidéos sont accordées
                dans l&apos;application Android NexusLink.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4 pb-4">
              {folders.map((folder) => (
                <button
                  key={folder.bucketId}
                  type="button"
                  onClick={() => {
                    setSelectedFolder(folder);
                    setFilter("ALL");
                    setViewerIndex(null);
                  }}
                  className="group text-left rounded-2xl bg-[#232934]/65 hover:bg-[#232934] border border-white/[0.07] hover:border-[#87CFF9]/40 p-2.5 transition cursor-pointer flex flex-col gap-2"
                >
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-[#14171c]">
                    <img
                      src={thumbUrl(folder.coverMediaType, folder.coverMediaId)}
                      alt={folder.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-200"
                    />
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/65 backdrop-blur-xs text-[10.5px] font-medium text-[#f2f5f8]">
                      {folder.itemCount}
                    </div>
                  </div>
                  <div className="px-0.5 min-w-0">
                    <div className="text-[13px] font-medium text-[#f2f5f8] truncate">
                      {folder.name}
                    </div>
                    <div className="text-[11px] text-[#788896] truncate">
                      {folder.photoCount > 0 &&
                        `${folder.photoCount} photo${folder.photoCount > 1 ? "s" : ""}`}
                      {folder.photoCount > 0 && folder.videoCount > 0 && " • "}
                      {folder.videoCount > 0 &&
                        `${folder.videoCount} vidéo${folder.videoCount > 1 ? "s" : ""}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : itemsLoading && items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2.5 text-[#9cb1c2]">
            <Loader2 className="w-6 h-6 animate-spin text-[#87CFF9]" />
            <span className="text-[12.5px]">
              Chargement des photos et vidéos…
            </span>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-[#788896]">
            <Images className="w-8 h-8 text-[#87CFF9]/50" />
            <p className="text-[13px] text-[#b0cadc]">
              Aucun média à afficher ici.
            </p>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {visibleItems.map((item, idx) => (
                <button
                  key={`${item.mediaType}-${item.id}`}
                  type="button"
                  onClick={() => setViewerIndex(idx)}
                  className="group relative aspect-square rounded-xl overflow-hidden bg-[#14171c] border border-white/[0.06] hover:border-[#87CFF9]/55 transition cursor-pointer focus:outline-none focus:border-[#87CFF9]"
                >
                  <img
                    src={thumbUrl(item.mediaType, item.id)}
                    alt={item.displayName}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-200"
                  />

                  {item.mediaType === "VIDEO" && (
                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-xs text-[10.5px] font-medium text-white flex items-center gap-1">
                      <Play className="w-2.5 h-2.5 fill-white" />
                      {formatDuration(item.durationMs)}
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/65 to-transparent opacity-0 group-hover:opacity-100 transition pointer-events-none flex items-end p-2">
                    <span className="text-[10.5px] text-white/90 truncate">
                      {item.displayName}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Sentinelle de chargement progressif (60 éléments par lot) */}
            {hasMore && (
              <div
                ref={sentinelRef}
                className="py-4 flex items-center justify-center"
              >
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() =>
                    loadItemsPage(
                      selectedFolder?.bucketId ?? null,
                      items.length,
                      true,
                    )
                  }
                  className="h-8 px-4 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-[12px] text-[#d6e4ee] flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {loadingMore && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#87CFF9]" />
                  )}
                  {loadingMore
                    ? "Chargement…"
                    : `Charger plus (${items.length} / ${totalItems})`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
