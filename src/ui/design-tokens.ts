import { type Mode } from "../agent/modes.js";

export type DesignTokens = {
    mode: string;
    tools: string[];
    colors: {
        primary: string;
        secondary: string;
        background: string;
        surface: string;
        text: string;
        "on-background": string;
    };
    spacing: {
        xs: string;
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };
    typography: {
        fontFamily: string;
        fontSize: {
            sm: string;
            md: string;
            lg: string;
            xl: string;
        };
    };
};

export function exportDesignTokens(mode: Mode, tools: string[]): DesignTokens {
    return {
        mode,
        tools,
        colors: {
            primary: "#3b82f6",
            secondary: "#64748b",
            background: "#ffffff",
            surface: "#f8fafc",
            text: "#0f172a",
            "on-background": "#f1f5f9",
        },
        spacing: {
            xs: "0.5rem",
            sm: "0.75rem",
            md: "1rem",
            lg: "1.5rem",
            xl: "2rem",
        },
        typography: {
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: {
                sm: "0.875rem",
                md: "1rem",
                lg: "1.125rem",
                xl: "1.25rem",
            },
        },
    };
}

export function exportDesignTokensJson(mode: Mode, tools: string[]): string {
    const tokens = exportDesignTokens(mode, tools);
    return JSON.stringify(tokens, null, 2);
}
