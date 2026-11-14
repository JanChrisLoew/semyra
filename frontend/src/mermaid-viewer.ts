const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const FIT = ZOOM_LEVELS.indexOf(1);

export class MermaidViewer {
  private readonly dialog = document.querySelector<HTMLDialogElement>('#mermaid-dialog')!;
  private readonly viewport = document.getElementById('mermaid-dialog-body')!;
  private readonly stage = document.getElementById('mermaid-dialog-stage')!;
  private readonly zoomIn = document.querySelector<HTMLButtonElement>('#mermaid-zoom-in')!;
  private readonly zoomOut = document.querySelector<HTMLButtonElement>('#mermaid-zoom-out')!;
  private readonly level = document.querySelector<HTMLOutputElement>('#mermaid-zoom-level')!;
  private readonly resizeObserver = new ResizeObserver(() => this.resizeDiagram());
  private step = FIT;
  private drag?: { pointerId: number; x: number; y: number; left: number; top: number };

  constructor() {
    this.zoomIn.addEventListener('click', () => this.setZoom(this.step + 1));
    this.zoomOut.addEventListener('click', () => this.setZoom(this.step - 1));
    document.getElementById('mermaid-zoom-fit')!.addEventListener('click', () => {
      this.setZoom(FIT);
      this.viewport.scrollTo(0, 0);
    });
    this.stage.addEventListener('pointerdown', (event) => this.startDrag(event));
    this.stage.addEventListener('pointermove', (event) => {
      const drag = this.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.viewport.scrollLeft = drag.left + drag.x - event.clientX;
      this.viewport.scrollTop = drag.top + drag.y - event.clientY;
    });
    this.stage.addEventListener('lostpointercapture', (event) => {
      if (this.drag?.pointerId === event.pointerId) this.endDrag();
    });
    this.stage.addEventListener('dragstart', (event) => {
      if (this.drag) event.preventDefault();
    });
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return;
      this.dialog.returnValue = '';
      this.endDrag();
      this.resizeObserver.disconnect();
      this.stage.replaceChildren();
    });
  }

  private startDrag(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || event.button !== 0 || this.drag
      || !this.viewport.classList.contains('can-pan') || event.defaultPrevented
      || (event.target instanceof Element && event.target.closest('a, button, input'))) return;
    this.stage.setPointerCapture(event.pointerId);
    this.drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: this.viewport.scrollLeft,
      top: this.viewport.scrollTop,
    };
    this.viewport.classList.add('is-panning');
  }

  private endDrag(): void {
    const pointerId = this.drag?.pointerId;
    this.drag = undefined;
    if (pointerId !== undefined && this.stage.hasPointerCapture(pointerId)) {
      this.stage.releasePointerCapture(pointerId);
    }
    this.viewport.classList.remove('is-panning');
  }

  open(source: SVGSVGElement): void {
    if (this.dialog.open) return;
    const svg = source.cloneNode(true) as SVGSVGElement;
    // Mermaid caps its SVG at the original render width with an inline max-width.
    svg.style.removeProperty('max-width');
    this.stage.replaceChildren(svg);
    this.dialog.showModal();
    this.setZoom(FIT);
    this.viewport.scrollTo(0, 0);
    this.resizeObserver.observe(this.viewport, { box: 'border-box' });
  }

  private setZoom(step: number): void {
    this.step = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, step));
    this.level.value = `${Math.round(ZOOM_LEVELS[this.step] * 100)}%`;
    this.zoomOut.disabled = this.step === 0;
    this.zoomIn.disabled = this.step === ZOOM_LEVELS.length - 1;
    this.resizeDiagram();
  }

  private resizeDiagram(): void {
    const svg = this.stage.querySelector('svg');
    if (!svg || !this.dialog.open) return;
    const { width, height } = svg.viewBox.baseVal;
    if (width <= 0 || height <= 0) return;
    const fit = Math.min(this.viewport.clientWidth / width, this.viewport.offsetHeight / height);
    const scale = fit * ZOOM_LEVELS[this.step];
    svg.style.width = `${Math.floor(width * scale)}px`;
    svg.style.height = `${Math.floor(height * scale)}px`;
    const canPan = this.viewport.scrollWidth > this.viewport.clientWidth
      || this.viewport.scrollHeight > this.viewport.clientHeight;
    this.viewport.classList.toggle('can-pan', canPan);
    if (!canPan && this.drag) this.endDrag();
  }
}
