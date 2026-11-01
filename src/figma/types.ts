export interface FigmaUrl {
  fileKey: string;
  nodeId?: string;
  pageId?: string;
  url: string;
}

export interface FigmaDesignContext {
  fileKey: string;
  nodeId?: string;
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  nodes: FigmaNode[];
  variables?: FigmaVariable[];
  components?: FigmaComponent[];
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  // Layout
  layoutMode?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  // Dimensions
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  // Visual
  fills?: any[];
  strokes?: any[];
  effects?: any[];
  cornerRadius?: number;
  opacity?: number;
  // Typography
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
  };
  characters?: string;
  // Components
  componentId?: string;
  componentProperties?: Record<string, any>;
}

export interface FigmaVariable {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, any>;
}

export interface FigmaComponent {
  id: string;
  name: string;
  description?: string;
  componentSetId?: string;
}

export interface FigmaAsset {
  nodeId: string;
  name: string;
  type: string;
  role: "hero" | "icon" | "logo" | "avatar" | "product" | "background" | "decorative" | "reference";
  section: number;
  bbox: { x: number; y: number; w: number; h: number };
  format: "svg" | "png" | "jpg";
  scale: number;
  localPath?: string;
  sourceUrl?: string;
  status: "pending" | "downloaded" | "failed" | "placeholder" | "rejected";
  usedBy: string[];
  size?: number;
}

export interface FigmaDesignSpec {
  source: {
    fileKey: string;
    nodeId?: string;
    url: string;
  };
  frame: {
    name: string;
    width: number;
    height: number;
  };
  layout: {
    type: string;
    direction?: string;
    padding?: { top: number; right: number; bottom: number; left: number };
    gap?: number;
    alignment?: string;
  };
  tokens: {
    colors: Record<string, string>;
    spacing: Record<string, number>;
    typography: Record<string, any>;
  };
  components: {
    id: string;
    name: string;
    type: string;
    reusable: boolean;
  }[];
  assets: FigmaAsset[];
  interactions: string[];
  unresolved: string[];
}