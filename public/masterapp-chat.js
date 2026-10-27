(function(){
  var script=document.currentScript;
  if(!script)return;
  var key=script.getAttribute("data-store");
  if(!key||!/^[0-9a-f-]{36}$/i.test(key))return;
  var base=new URL(script.src).origin;
  var frame=document.createElement("iframe");
  frame.src=base+"/widget/"+encodeURIComponent(key)+"?origin="+encodeURIComponent(location.origin);
  frame.title="Atendimento online";
  frame.setAttribute("aria-label","Abrir atendimento online");
  frame.style.cssText="position:fixed;right:18px;bottom:18px;width:min(390px,calc(100vw - 24px));height:min(650px,calc(100vh - 36px));border:0;border-radius:22px;box-shadow:0 20px 70px rgba(0,0,0,.35);z-index:2147483646;background:transparent";
  frame.setAttribute("allow","clipboard-write");
  document.body.appendChild(frame);
})();

