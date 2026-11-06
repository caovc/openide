import { hostOs } from "@/platform/remote";

export const isWindows = () => hostOs() === "windows";
