import { Brand as SharedBrand } from "@thcpn/ui";

export function BrandLogo() {
  return (
    <svg
      className="platform-brand-mark"
      width="28"
      height="28"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3 9.5h16.5l4.8 17.7 4.5-13.1h4.3l4.4 13.1 4.8-17.7H47l-7.1 29h-5.5l-3.6-12.2-4.1 12.2H3zM6.7 13h10v4h-3.1v14h3.1v4h-10v-4h3.1V17H6.7z"
      />
    </svg>
  );
}

export function Brand({ showDescription }: { showDescription?: boolean }) {
  return <SharedBrand showDescription={showDescription} mark={<BrandLogo />} />;
}
