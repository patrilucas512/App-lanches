import { FORECAST_COPILOT_TOOLS, forecastCopilot } from "./core.ts";

export const getDemandForecast = (context: Record<string, unknown>) => forecastCopilot("getDemandForecast", context);
export const getPeakHoursForecast = (context: Record<string, unknown>) => forecastCopilot("getPeakHoursForecast", context);
export const getProductDemandForecast = (context: Record<string, unknown>) => forecastCopilot("getProductDemandForecast", context);
export const getInventoryRiskForecast = (context: Record<string, unknown>) => forecastCopilot("getInventoryRiskForecast", context);
export const getStaffingForecast = (context: Record<string, unknown>) => forecastCopilot("getStaffingForecast", context);
export const getDeliveryLoadForecast = (context: Record<string, unknown>) => forecastCopilot("getDeliveryLoadForecast", context);
export const getForecastAccuracy = (context: Record<string, unknown>) => forecastCopilot("getForecastAccuracy", context);
export { FORECAST_COPILOT_TOOLS };
