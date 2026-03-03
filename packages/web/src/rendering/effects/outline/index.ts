import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import vertexShader from "./vert.glsl?raw";
import fragmentShader from "./frag.glsl?raw";

export class WdEdgePass extends Pass {
  private normalMaterial: THREE.MeshNormalMaterial;
  private fillMaterial: THREE.MeshBasicMaterial;
  private depthOnlyMaterial: THREE.MeshBasicMaterial;
  private fsQuad: FullScreenQuad;

  private outlineMaterial: THREE.ShaderMaterial;
  private normalRenderTarget = new THREE.WebGLRenderTarget();
  private fillRenderTarget = new THREE.WebGLRenderTarget();

  // When false, skip fill sub-passes (2 extra scene renders) for better perf
  public fillEnabled = false;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    super();
    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.fillMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.depthOnlyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.fsQuad = new FullScreenQuad();

    this.outlineMaterial = new THREE.ShaderMaterial({
      name: "outline shader",
      uniforms: {
        tDepth: { value: null },
        tNormal: { value: null },
        tFill: { value: null },
        texelSize: { value: null },
      },
      vertexShader,
      fragmentShader,
    });

    this.fsQuad.material = this.outlineMaterial;
    this.setSize(width, height);
  }

  setSize(width: number, height: number) {
    this.normalRenderTarget.depthTexture?.dispose();
    const depthTexture = new THREE.DepthTexture(width, height);

    this.normalRenderTarget.setSize(width, height);
    this.normalRenderTarget.depthTexture = depthTexture;

    // Fill render target needs its own depth texture for occlusion
    this.fillRenderTarget.depthTexture?.dispose();
    const fillDepthTexture = new THREE.DepthTexture(width, height);
    this.fillRenderTarget.setSize(width, height);
    this.fillRenderTarget.depthTexture = fillDepthTexture;

    this.outlineMaterial.uniforms.tDepth.value = depthTexture;
    this.outlineMaterial.uniforms.tNormal.value =
      this.normalRenderTarget.texture;
    this.outlineMaterial.uniforms.tFill.value =
      this.fillRenderTarget.texture;
    this.outlineMaterial.uniforms.texelSize.value = new THREE.Vector2(
      1 / width,
      1 / height,
    );
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
    const oldOverride = this.scene.overrideMaterial;

    /// 1. Normal/depth pass (all meshes on default layer 0)
    this.scene.overrideMaterial = this.normalMaterial;
    renderer.setRenderTarget(this.normalRenderTarget);
    renderer.render(this.scene, this.camera);

    /// 2. Fill pass with depth occlusion (only when tag text is visible)
    if (this.fillEnabled) {
      // 2a. Depth pre-pass: render ALL geometry (depth only) to fill RT
      const savedMask = this.camera.layers.mask;
      this.camera.layers.enableAll();
      this.scene.overrideMaterial = this.depthOnlyMaterial;
      renderer.setRenderTarget(this.fillRenderTarget);
      renderer.clear();
      renderer.render(this.scene, this.camera);

      // 2b. Color pass: render only layer-1 meshes as white, with depth test
      //     so text behind the plate body is occluded
      this.camera.layers.set(1);
      this.scene.overrideMaterial = this.fillMaterial;
      renderer.autoClearColor = false;
      renderer.autoClearDepth = false;
      renderer.render(this.scene, this.camera);
      renderer.autoClearColor = true;
      renderer.autoClearDepth = true;
      this.camera.layers.mask = savedMask;
    } else {
      // Clear fill RT so the shader reads 0 (no fill)
      renderer.setRenderTarget(this.fillRenderTarget);
      renderer.clear();
    }

    // Restore
    this.scene.overrideMaterial = oldOverride;

    /// 3. Outline + fill composite
    renderer.setRenderTarget(writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.normalMaterial.dispose();
    this.fillMaterial.dispose();
    this.depthOnlyMaterial.dispose();
    this.fsQuad.dispose();
    this.outlineMaterial.dispose();
    this.normalRenderTarget.dispose();
    this.fillRenderTarget.dispose();
  }
}
