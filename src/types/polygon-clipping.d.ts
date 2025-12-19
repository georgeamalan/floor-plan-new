declare module 'polygon-clipping' {
  type Ring = [number, number][];
  type Polygon = Ring[];
  type MultiPolygon = Polygon[];

  export function union(...polygons: (Polygon | MultiPolygon)[]): MultiPolygon;
  export function intersection(...polygons: (Polygon | MultiPolygon)[]): MultiPolygon;
  export function difference(subject: Polygon | MultiPolygon, ...clip: (Polygon | MultiPolygon)[]): MultiPolygon;
  export function xor(...polygons: (Polygon | MultiPolygon)[]): MultiPolygon;

  const _default: {
    union: typeof union;
    intersection: typeof intersection;
    difference: typeof difference;
    xor: typeof xor;
  };
  export default _default;
}
