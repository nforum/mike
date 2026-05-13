import React from "react";

export default function MikeLogo({
    size = 28,
    className = "",
}: {
    size?: number;
    className?: string;
}) {
    return (
        <span
            className={`inline-flex items-center justify-center rounded-md bg-mike-600 text-white font-serif font-medium ${className}`}
            style={{
                width: size,
                height: size,
                fontSize: size * 0.55,
                lineHeight: 1,
            }}
        >
            m
        </span>
    );
}
