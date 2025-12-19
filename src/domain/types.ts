export type Units = 'cm' | 'm' | 'ft';

export type Plan = {
  version: '1.0';
  units: Units;
  canvas: {
    width: number;
    height: number;
    zoom: number;
    pan: { x: number; y: number };
  };
  areas: Area[];
  areaGroups?: AreaGroup[];
  meta: {
    name: string;
    createdAt: string;
    updatedAt: string;
  };
};

export type Area = {
  id: string;
  name: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shape: RectShape | PolygonShape | MultiPolygonShape;
  parentId?: string;
};

export type RectShape = {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  cornerRadius?: number;
};

export type PolygonShape = {
  type: 'polygon';
  points: { x: number; y: number }[];
  rotation?: number;
};

export type MultiPolygonShape = {
  type: 'multipolygon';
  polygons: { x: number; y: number }[][];
};

export type Selection = {
  areaIds: string[];
};

export type RectHandle =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

export type BoundaryHandle = 'left' | 'right' | 'top' | 'bottom';

export type PartitionDirection = 'horizontal' | 'vertical';

export type Tool =
  | 'select'
  | 'draw-rect'
  | 'draw-polygon'
  | 'divide'
  | 'pan'
  | 'fill'
  | 'label'
  | 'delete';

export type CommandType =
  | 'plan/create'
  | 'plan/resize-boundary'
  | 'plan/set-viewport'
  | 'plan/load'
  | 'area/create'
  | 'area/create-polygon'
  | 'area/move'
  | 'area/move-polygon'
  | 'area/resize'
  | 'area/set-rect'
  | 'area/set-rect-batch'
  | 'area/set-polygon'
  | 'area/set-multipolygon'
  | 'area/move-multi'
  | 'area/rename'
  | 'area/recolor'
  | 'area/delete'
  | 'area/divide'
  | 'area/merge'
  | 'group/create'
  | 'group/delete'
  | 'group/visibility'
  | 'area/convert-to-polygon'
  | 'area/paste'
  | 'selection/set';

export type CommandPayloads = {
  'plan/create': { width: number; height: number; units: Units; name?: string };
  'plan/resize-boundary': { width?: number; height?: number };
  'plan/set-viewport': { zoom?: number; pan?: { x: number; y: number } };
  'plan/load': { plan: Plan };
  'area/create': {
    rect: RectShape;
    partitions?: number;
    direction?: PartitionDirection;
    fill?: string;
    stroke?: string;
    name?: string;
    parentId?: string;
  };
  'area/create-polygon': {
    points: { x: number; y: number }[];
    fill?: string;
    stroke?: string;
    name?: string;
  };
  'area/move-polygon': { id: string; dx: number; dy: number };
  'area/move': { id: string; dx: number; dy: number };
  'area/resize': { id: string; handle: RectHandle; dx: number; dy: number };
  'area/set-rect': { id: string; rect: RectShape };
  'area/set-rect-batch': { updates: { id: string; rect: RectShape }[] };
  'area/set-polygon': { id: string; points: { x: number; y: number }[] };
  'area/set-multipolygon': { id: string; polygons: { x: number; y: number }[][] };
  'area/move-multi': { ids: string[]; dx: number; dy: number };
  'area/rename': { id: string; name: string };
  'area/recolor': { id: string; fill: string };
  'area/delete': { id: string };
  'area/divide': { id: string; partitions: number; direction?: PartitionDirection };
  'area/merge': { ids: string[]; name?: string; fill?: string; stroke?: string };
  'group/create': { name: string; areaIds: string[] };
  'group/delete': { id: string };
  'group/visibility': { id: string; visible: boolean };
  'area/convert-to-polygon': { ids: string[]; name?: string; fill?: string; stroke?: string };
  'area/paste': { areas: Area[]; dx: number; dy: number; nameSuffix?: string };
  'selection/set': Selection;
};

export type Command = {
  [K in CommandType]: { type: K; payload: CommandPayloads[K] };
}[CommandType];

export type AreaGroup = {
  id: string;
  name: string;
  areaIds: string[];
  locked?: boolean;
  visible?: boolean;
};

export type CommandRecord<T extends CommandType = CommandType> = {
  type: T;
  payload: CommandPayloads[T];
  description: string;
  before: Plan;
  after: Plan;
  timestamp: number;
};

export type HistoryStack = {
  undo: CommandRecord[];
  redo: CommandRecord[];
};
