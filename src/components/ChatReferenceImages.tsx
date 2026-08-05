import { cn } from "@/lib/utils";

export type ChatDownloadLink = {
  url: string;
  title: string;
  fileName?: string;
};

export type ChatRefImage = {
  url: string;
  title?: string;
  collection?: string;
  file_name?: string;
};

/** Drop auto footers / invented markdown when photos/downloads are shown as cards. */
export function cleanChatExtrasCaption(
  text: string,
  options: { hasImages?: boolean; hasDownloads?: boolean },
): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  if (options.hasImages) {
    out = out
      .replace(/\n*\s*Sharing \d+ reference photo\(s\)[^\n]*/gi, "")
      .replace(/\n*\s*Sending \d+ reference photo\(s\)[^\n]*/gi, "");
  }
  if (options.hasDownloads) {
    out = out
      .replace(/\n*\s*Downloads:\n(?:[•\-*].*\n?)+/gi, "")
      .replace(/📄\s*\[[^\]]+\.pdf\]\([^)]+\)/gi, "")
      .replace(/\[[^\]]+\.pdf\]\([^)]+\)/gi, "")
      .replace(/https?:\/\/[^\s)]+\/f\/[^\s)]+/gi, "")
      .replace(/https?:\/\/[^\s)]+\/d\/[^\s)]+/gi, "")
      .replace(/https?:\/\/[^\s)]+\/c\/[^\s)]+/gi, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** @deprecated use cleanChatExtrasCaption */
export function cleanReferenceCaption(text: string, hasImages: boolean): string {
  return cleanChatExtrasCaption(text, { hasImages });
}

export function ChatReferenceImages(props: {
  images: ChatRefImage[];
  brand?: string;
  className?: string;
}) {
  const brand = props.brand || "#0B2388";
  if (!props.images.length) return null;

  return (
    <div className={cn("space-y-2", props.className)}>
      {props.images.map((img) => {
        const label =
          (img.title && !/^reference\s*photo$/i.test(img.title) ? img.title : null) || "Product photo";
        return (
          <a
            key={img.url}
            href={img.url}
            target="_blank"
            rel="noreferrer"
            className="group block overflow-hidden rounded-lg border transition-opacity hover:opacity-95"
            style={{ borderColor: `${brand}22`, backgroundColor: "#F3F5FA" }}
            title="Open or save photo"
          >
            <div className="flex max-h-48 items-center justify-center bg-[#EEF1F8]">
              <img
                src={img.url}
                alt={label}
                className="max-h-48 w-full object-contain"
                loading="lazy"
              />
            </div>
            <div
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] leading-tight"
              style={{ color: brand, backgroundColor: "#FFFFFF" }}
            >
              <span className="min-w-0 truncate font-medium">{label}</span>
              <span className="shrink-0 opacity-70 group-hover:opacity-100">Open / save</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export function ChatDownloadLinks(props: {
  links: ChatDownloadLink[];
  brand?: string;
  className?: string;
}) {
  const brand = props.brand || "#0B2388";
  if (!props.links.length) return null;

  return (
    <div className={cn("space-y-1.5", props.className)}>
      {props.links.map((link) => {
        const name = (link.fileName || link.title || "Catalogue.pdf").trim();
        const label = /^catalogue$/i.test(name)
          ? "Catalogue.pdf"
          : /\.pdf$/i.test(name)
            ? name
            : `${name}.pdf`;
        return (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-opacity hover:opacity-90"
            style={{ borderColor: `${brand}33`, backgroundColor: "#F7F8FC", color: brand }}
            title={`Download ${label}`}
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-md text-[10px] font-bold"
              style={{ backgroundColor: brand, color: "#fff" }}
            >
              PDF
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="shrink-0 text-[10px] opacity-70">Download</span>
          </a>
        );
      })}
    </div>
  );
}
