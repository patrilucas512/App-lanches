"use client";

import { useEffect } from "react";

const DESTINATION_KEY = "masterapp_install_destination";

export default function OpenInstalledAppPage() {
  useEffect(() => {
    const destination = localStorage.getItem(DESTINATION_KEY);
    const safeDestination = destination?.startsWith("/") && !destination.startsWith("//") ? destination : "/";
    window.location.replace(safeDestination);
  }, []);

  return <main className="installed-app-launch"><span aria-hidden="true">M</span><b>Abrindo MasterApp...</b></main>;
}
