"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"


const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <i className="ri-checkbox-circle-line text-base" />
        ),
        info: (
          <i className="ri-information-line text-base" />
        ),
        warning: (
          <i className="ri-alert-line text-base" />
        ),
        error: (
          <i className="ri-close-circle-line text-base" />
        ),
        loading: (
          <i className="ri-loader-4-line animate-spin text-base" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
