declare const __HOST_SDK_VERSION__: string;

/** The version of this package (filled in by the build; `0.0.0-dev` when run from source). */
export const HOST_SDK_VERSION: string = typeof __HOST_SDK_VERSION__ !== 'undefined' ? __HOST_SDK_VERSION__ : '0.0.0-dev';
