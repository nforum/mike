import Link from "next/link";
import { MikeIcon } from "@/components/chat/mike-icon";

interface SiteLogoProps {
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
    animate?: boolean;
    asLink?: boolean;
}

export function SiteLogo({
    size = "md",
    className = "",
    animate = false,
    asLink = false,
}: SiteLogoProps) {
    const landingHref =
        process.env.NODE_ENV === "production"
            ? "https://max.eulex.ai"
            : "http://localhost:3000";
    const sizeClasses = {
        sm: "text-xl",
        md: "text-2xl",
        lg: "text-4xl",
        xl: "text-6xl",
    };

    const iconSizes = {
        sm: 24,
        md: 30,
        lg: 44,
        xl: 64,
    };

    const logo = (
        <h1
            className={`flex items-center gap-2 leading-none ${sizeClasses[size]} font-light font-serif ${
                animate ? "sidebar-fade-in" : ""
            } ${className}`}
        >
            <MikeIcon size={iconSizes[size]} />
            <span className="leading-none">Max</span>
        </h1>
    );

    if (asLink) {
        return (
            <Link
                href={landingHref}
                className="cursor-pointer hover:opacity-80 transition-opacity"
            >
                {logo}
            </Link>
        );
    }

    return logo;
}
