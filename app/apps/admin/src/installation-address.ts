import { useCascaderAreaData as getAreaData } from "@vant/area-data";

type RegionOption = { value: string; label: string; children?: RegionOption[] };
type Area = ReturnType<typeof getAreaData>[number];

function regionOption(area: Area): RegionOption {
  return { value: area.value, label: area.text, children: area.children?.map(regionOption) };
}

export const installationRegions: RegionOption[] = getAreaData().map(province => ({
  ...regionOption(province),
  // Municipalities and directly administered counties don't need a fictitious city level.
  children: province.children?.flatMap(city => {
    const grouping = city.text === province.text || /^(市辖区|县)$|直辖/.test(city.text);
    return grouping && city.children?.length ? city.children.map(regionOption) : [regionOption(city)];
  }),
}));

export function splitInstallationAddress(value: string | undefined): { region: string[]; detail: string } {
  const region: string[] = [];
  let detail = value?.trim() ?? "";
  let options = installationRegions;
  while (options.length > 0) {
    const candidate = detail.replace(/^[\s/／]+/, "");
    const match = options.reduce<RegionOption | undefined>((longest, option) =>
      candidate.startsWith(option.label) && option.label.length > (longest?.label.length ?? 0) ? option : longest,
    undefined);
    if (!match) break;
    region.push(match.value);
    detail = candidate.slice(match.label.length).trimStart();
    options = match.children ?? [];
  }
  return { region, detail };
}

export function formatInstallationAddress(region: string[] = [], detail = ""): string {
  const labels: string[] = [];
  let options = installationRegions;
  for (const code of region) {
    const option = options.find(item => item.value === code);
    if (!option) break;
    labels.push(option.label);
    options = option.children ?? [];
  }
  return [...labels, detail.trim()].filter(Boolean).join(" ");
}
