import { getChannelBrand } from "@/lib/channel-brand";
import { cn } from "@/lib/utils";

const SIZE = { sm: 16, md: 36, lg: 44 } as const;

/** Official marks fetched from Wikimedia / the platform’s public icon (not letter placeholders). */
const LOGO_SRC: Record<string, string> = {
  whatsapp: "/channel-logos/whatsapp.svg",
  instagram: "/channel-logos/instagram.png",
  facebook: "/channel-logos/facebook.svg",
  email: "/channel-logos/gmail.svg",
  wordpress: "/channel-logos/wordpress.svg",
  indiamart: "/channel-logos/indiamart.png",
  tradeindia: "/channel-logos/tradeindia.png",
};

function Letters({ text, fill }: { text: string; fill: string }) {
  return (
    <text
      x="12"
      y="12.5"
      textAnchor="middle"
      dominantBaseline="central"
      fill={fill}
      fontSize={text.length > 2 ? 8 : 9}
      fontWeight="700"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
    >
      {text}
    </text>
  );
}

function FallbackGlyph({ channel, fg }: { channel: string; fg: string }) {
  switch (channel) {
    case "website":
      return (
        <g fill="none" stroke={fg} strokeWidth="1.5">
          <circle cx="12" cy="12" r="6.2" />
          <path d="M6 12h12M12 6c1.8 1.8 2.7 3.8 2.7 6S13.8 16.2 12 18C10.2 16.2 9.3 14.2 9.3 12S10.2 7.8 12 6z" />
        </g>
      );
    case "brainmine":
      return <Letters text="BM" fill={fg} />;
    default:
      return <Letters text={channel.slice(0, 2).toUpperCase() || "CH"} fill={fg} />;
  }
}

/** Round partner mark — official logo images where we have them; BM/website stay drawn. */
export function ChannelBrandMark(props: {
  channel: string | null | undefined;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const channel = String(props.channel || "website").toLowerCase();
  const brand = getChannelBrand(channel);
  const px = SIZE[props.size || "sm"];
  const logo = LOGO_SRC[channel];

  if (logo) {
    return (
      <span
        className={cn(
          "inline-grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-white shadow-sm",
          props.className,
        )}
        style={{ width: px, height: px }}
        title={brand.label}
        aria-label={brand.label}
      >
        <img src={logo} alt="" className="size-full object-contain" />
      </span>
    );
  }

  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full shadow-sm", props.className)}
      style={{ width: px, height: px, background: brand.accent }}
      title={brand.label}
      aria-label={brand.label}
    >
      <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden>
        <FallbackGlyph channel={channel} fg={brand.fg} />
      </svg>
    </span>
  );
}
