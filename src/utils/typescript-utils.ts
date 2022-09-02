type PickNullable<T> = {
  [P in keyof T as undefined extends T[P] ? P : never]: T[P];
};

type PickNotNullable<T> = {
  [P in keyof T as undefined extends T[P] ? never : P]: T[P];
};

export type OptionalNullable<T> = {
  [K in keyof PickNullable<T>]?: NonNullable<T[K]>;
} & {
  [K in keyof PickNotNullable<T>]: T[K];
};

export type FilterNullable<T extends any[]> = T extends []
  ? []
  : T extends [infer Head, ...infer Tail]
  ? Head extends null
    ? FilterNullable<Tail>
    : [Head, ...FilterNullable<Tail>]
  : [];

export type ExtractObjectPath<T extends object, K extends readonly PropertyKey[]> = K extends []
  ? T
  : K extends readonly [infer K1, ...infer KR]
  ? K1 extends keyof T
    ? NonNullable<T[K1]> extends object
      ? KR extends readonly PropertyKey[]
        ? ExtractObjectPath<NonNullable<T[K1]>, KR>
        : never
      : NonNullable<T[K1]>
    : never
  : never;

export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type DeepPartial<T> = T extends object ? Partial<{ [P in keyof T]: DeepPartial<T[P]> }> : T;
