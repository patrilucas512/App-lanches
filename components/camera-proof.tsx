"use client";
import { useEffect, useRef, useState } from "react";

export function CameraProof({ onCapture }: { onCapture: (file: File | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  function stop() { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop(); }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function open() {
    setBusy(true); setMessage(""); stop(); onCapture(null); setPreview("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!mounted.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      setActive(true);
    } catch { stop(); setMessage("Não foi possível abrir a câmera. Permita o acesso à câmera neste celular e tente novamente."); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function capture() {
    const source = video.current;
    if (!source?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(source.videoWidth, source.videoHeight));
    canvas.width = Math.round(source.videoWidth * scale); canvas.height = Math.round(source.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .9));
    if (!blob || !mounted.current) return;
    const file = new File([blob], "comprovante-camera.jpg", { type: "image/jpeg" });
    onCapture(file); setPreview(URL.createObjectURL(file)); stop(); setActive(false);
  }
  return <div className="camera-proof"><p>Foto obrigatória do comprovante da maquininha. Ela ficará vinculada ao responsável pelo fechamento. Não fotografe o cartão do cliente.</p>
    <video ref={video} muted playsInline hidden={!active} aria-label="Câmera do comprovante" />
    {preview && <img src={preview} alt="Confira se os dados do comprovante estão legíveis" />}
    <button type="button" className="button outline" disabled={busy} onClick={open}>{busy ? "Abrindo câmera..." : preview ? "Tirar outra foto" : "Abrir câmera do celular"}</button>
    {active && <button type="button" className="button dark" onClick={capture}>Fotografar comprovante</button>}
    {message && <p role="alert">{message}</p>}
  </div>;
}
