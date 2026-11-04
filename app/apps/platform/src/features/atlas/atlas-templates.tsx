import type { ComponentType, ReactNode } from "react";
import { useLocale } from "@thcpn/i18n";
import type { AtlasConfig } from "@thcpn/api";
import { Button } from "../../shared/ui";

export type AtlasPresentation = NonNullable<AtlasConfig["presentation"]>;
type AtlasSlots = {
  summary?: ReactNode;
  directory: ReactNode;
  map: ReactNode;
  inspector: ReactNode;
  analysis?: ReactNode;
  mobilePanel?: string;
};

export function MobileAtlasLayout({ summary, directory, map, inspector, mobilePanel }: AtlasSlots) {
  return <div className="atlas-mobile-workbench">
    {map}
    <div className="atlas-mobile-panel" hidden={mobilePanel !== "directory"}>{summary}{directory}</div>
    <div className="atlas-mobile-panel" hidden={mobilePanel !== "inspector"}>{inspector}</div>
  </div>;
}
type AtlasTemplate = {
  id: AtlasPresentation;
  titleKey: string;
  descriptionKey: string;
  initialTab: "metrics" | "images";
  Layout?: ComponentType<AtlasSlots>;
};

// Layouts own composition only. Queries, permissions and device selection stay
// in the workspace, so a new template cannot accidentally fork data behavior.
function TechnologyLayout({ summary, directory, map, inspector, analysis }: AtlasSlots) {
  return (
    <div className="atlas-workbench">
      <div className="atlas-directory-column">{summary}{directory}</div>
      <div className="atlas-map-stack">
        {map}
        {analysis}
      </div>
      {inspector}
    </div>
  );
}
function PanoramaLayout({ directory, map, inspector }: AtlasSlots) {
  return (
    <div className="atlas-panorama-workbench">
      {map}
      {directory}
      {inspector}
    </div>
  );
}

export const atlasTemplates: readonly AtlasTemplate[] = [
  {
    id: "deep-blue",
    titleKey: "templateDeepBlue",
    descriptionKey: "templateDeepBlueHint",
    initialTab: "metrics",
  },
  {
    id: "technology",
    titleKey: "templateTechnology",
    descriptionKey: "templateTechnologyHint",
    initialTab: "metrics",
    Layout: TechnologyLayout,
  },
  {
    id: "panorama",
    titleKey: "templatePanorama",
    descriptionKey: "templatePanoramaHint",
    initialTab: "metrics",
    Layout: PanoramaLayout,
  },
];
export function atlasTemplate(id?: string) {
  return (
    atlasTemplates.find((template) => template.id === id) ?? atlasTemplates[0]
  );
}

export function AtlasTemplatePreview({ id }: { id: AtlasPresentation }) {
  return (
    <span className={`atlas-template-preview preview-${id}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function AtlasTemplateChoices({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: AtlasPresentation) => void;
}) {
  const { t } = useLocale();
  return (
    <div
      className="atlas-template-choices"
      role="group"
      aria-label={t("atlas.chooseTemplate")}
    >
      {atlasTemplates.map((template) => (
        <Button
          key={template.id}
          variant="ghost"
          className={`atlas-template-card ${atlasTemplate(value).id === template.id ? "is-selected" : ""}`}
          aria-pressed={atlasTemplate(value).id === template.id}
          onClick={() => onChange(template.id)}
        >
          <AtlasTemplatePreview id={template.id} />
          <strong>{t(`atlas.${template.titleKey}`)}</strong>
          <span>{t(`atlas.${template.descriptionKey}`)}</span>
        </Button>
      ))}
    </div>
  );
}
