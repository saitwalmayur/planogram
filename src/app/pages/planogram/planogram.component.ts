import { Component, AfterViewInit, ElementRef, ViewChild, OnDestroy, HostListener, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SceneHierarchy } from './scene-hierarchy.component';
import { PropertiesPanelComponent } from './properties-panel/properties-panel.component';
import { TransformToolbarComponent } from './transform-toolbar.component';

interface SceneObjectData {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  children?: SceneObjectData[];
}

@Component({
  selector: 'app-planogram',
  imports: [CommonModule, FormsModule, PropertiesPanelComponent, SceneHierarchy, TransformToolbarComponent],
  templateUrl: './planogram.component.html',
  styleUrl: './planogram.component.scss'
})
export class PlanogramComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private rootCube!: THREE.Mesh;
  private animationId: number = 0;
  private isBrowser: boolean;
  private controls!: OrbitControls;
  private transformControl!: TransformControls;
  private composer!: EffectComposer;
  private outlinePass!: OutlinePass;

  private viewCubeScene!: THREE.Scene;
  private viewCubeCamera!: THREE.PerspectiveCamera;
  private viewCubeRenderer!: THREE.WebGLRenderer;
  private viewCubeContainer!: HTMLElement;
  private viewCubeControls!: any;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private interactableObjects: THREE.Object3D[] = [];

  // State
  public selectedObject: SceneObjectData | null = null;
  public objectDataList: SceneObjectData[] = [];
  public transformSpace: 'local' | 'world' = 'local';
  public currentTransformMode: 'translate' | 'rotate' | 'scale' | 'select' = 'translate';
  
  // Context Menu State
  public contextMenu = {
    visible: false,
    x: 0,
    y: 0,
    targetId: null as string | null,
    targetType: null as string | null
  };
  
  // Transform bindings
  public transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  };

  public snapEnabled = true;

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private cdr: ChangeDetectorRef
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit(): void {
    if (this.isBrowser) {
      // Wait for the next tick to ensure parent container dimensions are calculated
      setTimeout(() => {
        this.initThreeJsScene();
        this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
        this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu.bind(this));
        this.animate();
        this.onWindowResize();
        this.loadScene();
      }, 0);
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      if (this.animationId !== 0) {
        cancelAnimationFrame(this.animationId);
      }
      if (this.viewCubeControls?._dispose) {
        this.viewCubeControls._dispose();
      }
      if (this.viewCubeRenderer) {
        this.viewCubeRenderer.dispose();
      }
      if (this.renderer) {
        this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown.bind(this));
        this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu.bind(this));
        this.renderer.dispose();
      }
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.isBrowser && this.camera && this.renderer) {
      const container = this.canvasContainer.nativeElement;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
      if (this.composer) {
        this.composer.setSize(container.clientWidth, container.clientHeight);
      }
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!this.isBrowser || !this.transformControl) return;
    
    switch (event.key.toLowerCase()) {
      case 'w':
        this.setTransformMode('translate');
        break;
      case 'e':
        this.setTransformMode('scale');
        break;
      case 'r':
        this.setTransformMode('rotate');
        break;
      case 'escape':
        this.setTransformMode('select');
        break;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.contextMenu.visible) {
       this.contextMenu.visible = false;
    }
  }

  private initThreeJsScene(): void {
    const container = this.canvasContainer.nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1e293b');

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.z = 5;
    this.camera.position.y = 2;
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // HDRI environment (for realistic reflections)
    const hdriPath = '/HDRI/monochrome_studio_02_4k.hdr';
  new RGBELoader().load(hdriPath, (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;

  this.scene.environment = texture;
  this.scene.background = texture; // Show HDRI in viewport

  this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure = 1.0;

  setTimeout(() => this.cdr.detectChanges());
});

    // Lighting (more realistic)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambientLight);

    // Enable shadows for main lights
    const enableShadow = (light: THREE.Light & { castShadow?: boolean }) => {
      (light as any).castShadow = true;
      (light as any).shadow.mapSize.width = 1024;
      (light as any).shadow.mapSize.height = 1024;
      (light as any).shadow.bias = -0.0001;
      (light as any).shadow.radius = 2;
    };



    // Warm key light
    const keyLight = new THREE.DirectionalLight(0xfff2e6, 1.1);
    keyLight.position.set(6, 12, 8);
    enableShadow(keyLight);
    this.scene.add(keyLight);

    // Cool fill light
    const fillLight = new THREE.DirectionalLight(0xcfe8ff, 0.55);
    fillLight.position.set(-8, 6, -6);
    enableShadow(fillLight);
    this.scene.add(fillLight);

    // Subtle rim light
    const rimLight = new THREE.DirectionalLight(0xb7ffd6, 0.25);
    rimLight.position.set(0, 10, -12);
    enableShadow(rimLight);
    this.scene.add(rimLight);


    // Gentle ground bounce
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x0f172a, 0.25);
    hemiLight.position.set(0, 3, 0);
    this.scene.add(hemiLight);


    // Grid helper
    const gridHelper = new THREE.GridHelper(20, 20, 0x475569, 0x334155);
    this.scene.add(gridHelper);

    // Ground plane with wood floor texture
    const textureLoader = new THREE.TextureLoader();

    const floorTex = textureLoader.load('/Texture/wood_floor_diff_1k.jpg');
    const floorNrmTex = textureLoader.load('/Texture/wood_floor_diff_1k_NRM.png');

    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorNrmTex.wrapS = floorNrmTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(8, 8);
    floorNrmTex.repeat.set(8, 8);

    const groundGeo = new THREE.PlaneGeometry(50, 50);
    const groundMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      normalMap: floorNrmTex,
      roughness: 0.95,
      metalness: 0.0
    });

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);



    // Default cube removed (scene starts empty; user adds objects from Library).

    // OrbitControls setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // TransformControls setup
    this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControl.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (!event.value) {
        this.saveScene();
      }
    });
    this.transformControl.addEventListener('change', () => {
      if (this.selectedObject) {
         this.updateTransformViewFromModel();

         const type = this.selectedObject.mesh.userData['type'];
         // Snap objects while dragging, so releasing lands perfectly.
         if (type === 'door') {
           this.snapDoors();
           this.updateTransformViewFromModel();
         } else if (type === 'shelf') {
           this.snapShelfToTarget();
           this.updateTransformViewFromModel();
         } else if (type === 'cupboard') {
           this.snapCupboardToDoors();
           this.updateTransformViewFromModel();
         }

         this.cdr.detectChanges();
      }
    });
    
    // In recent Three.js versions, the control itself is not an Object3D. 
    // We must add its helper to the scene for the gizmo to be visible.
    this.scene.add(this.transformControl.getHelper());

    // Initialize state
    this.transformControl.setSpace(this.transformSpace);
    this.updateSnapSettings();

    // Setup Post-processing for Selection Outline
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.outlinePass = new OutlinePass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      this.scene,
      this.camera
    );
    this.outlinePass.edgeStrength = 3.0;
    this.outlinePass.edgeGlow = 0.5;
    this.outlinePass.edgeThickness = 1.0;
    this.outlinePass.visibleEdgeColor.set('#3b82f6'); // Highlight blue
    this.outlinePass.hiddenEdgeColor.set('#1e293b');  // Darker shade for hidden edges
    this.composer.addPass(this.outlinePass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    // View Cube Setup
    this.viewCubeScene = new THREE.Scene();
    this.viewCubeCamera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
    this.viewCubeCamera.position.z = 80;

    this.viewCubeContainer = document.createElement('div');
    this.viewCubeContainer.className = 'view-cube-overlay';
    this.viewCubeContainer.style.position = 'absolute';
    this.viewCubeContainer.style.bottom = '20px';
    this.viewCubeContainer.style.left = '20px';
    this.viewCubeContainer.style.width = '120px';
    this.viewCubeContainer.style.height = '120px';
    this.viewCubeContainer.style.zIndex = '1000';
    this.canvasContainer.nativeElement.appendChild(this.viewCubeContainer);

    this.viewCubeRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.viewCubeRenderer.setPixelRatio(window.devicePixelRatio);
    this.viewCubeRenderer.setSize(120, 120, false);
    this.viewCubeRenderer.domElement.style.display = 'block';
    this.viewCubeRenderer.domElement.style.width = '120px';
    this.viewCubeRenderer.domElement.style.height = '120px';
    this.viewCubeContainer.appendChild(this.viewCubeRenderer.domElement);

    this.viewCubeControls = new ViewCubeControls(this.viewCubeCamera, 40, 6, this.viewCubeContainer);
    this.viewCubeScene.add(this.viewCubeControls.getObject());

    this.viewCubeControls.addEventListener('angle-change', (event: any) => {
      if (this.controls) {
        const distance = this.camera.position.distanceTo(this.controls.target);
        const offset = new THREE.Vector3(0, 0, distance);
        // The camera's position relative to the target is the inverse of the cube's orientation
        const q = event.quaternion.clone().invert();
        offset.applyQuaternion(q);
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
      }
    });
  }

  private onPointerDown(event: PointerEvent): void {
    // If clicking on the gizmo itself, let TransformControls handle it
    if (this.transformControl.dragging || this.transformControl.axis !== null) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactableObjects, true);

    if (intersects.length > 0) {
      event.stopPropagation();
      const firstHit = intersects[0].object;
      const rootId = firstHit.userData['rootId'] || firstHit.uuid;
      this.selectObjectById(rootId);
    } else {
      this.selectObjectById(null);
    }
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (!this.isBrowser || this.transformControl.dragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactableObjects, true);

    if (intersects.length > 0) {
      let firstHit = intersects[0].object;
      let rootId = firstHit.userData['rootId'] || firstHit.uuid;
      let targetObj = this.interactableObjects.find(obj => obj.uuid === rootId) || firstHit;
      
      this.contextMenu.targetId = rootId;
      this.contextMenu.targetType = targetObj.userData['type'] || null;
      this.contextMenu.x = event.clientX;
      this.contextMenu.y = event.clientY;
      this.contextMenu.visible = true;
    } else {
      this.contextMenu.visible = false;
    }
    this.cdr.detectChanges();
  }

  public toggleVisibility(event: Event, id: string): void {
    event.stopPropagation();
    const objData = this.findObjectData(id);
    if (objData && objData.mesh) {
        objData.mesh.visible = !objData.mesh.visible;
        
        // If we hide the currently selected object, deselect it
        if (!objData.mesh.visible && this.selectedObject?.id === id) {
            this.selectObjectById(null);
        }
        this.saveScene();
    }
  }

  public selectObjectById(id: string | null): void {
    const newSelection = id ? (this.findObjectData(id) || null) : null;
    
    // If clicking the same object, ensure gizmo is attached and exit
    if (newSelection === this.selectedObject && id !== null) {
       if (this.selectedObject && this.currentTransformMode !== 'select') {
          this.transformControl.setMode(this.currentTransformMode as any);
          this.transformControl.attach(this.selectedObject.mesh);
       }
       return;
    }

    // Reset color for previous
    if (this.selectedObject) {
      this.selectedObject.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissive.setHex(0x000000);
        }
      });
    }
    
    this.selectedObject = newSelection;
    
    // Highlight current selected and attach gizmo
    if (this.selectedObject) {
      this.selectedObject.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissive.setHex(0x222222); // Slightly brighter highlight
        }
      });

      this.outlinePass.selectedObjects = [this.selectedObject.mesh];

      if (this.currentTransformMode !== 'select') {
        this.transformControl.setMode(this.currentTransformMode as any);
        this.transformControl.attach(this.selectedObject.mesh);
      } else {
        this.transformControl.detach();
      }

      this.updateTransformViewFromModel();
    } else {
      this.outlinePass.selectedObjects = [];
      this.transformControl.detach();
    }
    
    // Trigger Angular change detection since this may be invoked from a non-Angular DOM event
    this.cdr.detectChanges();
  }

  private updateTransformViewFromModel(): void {
    if (!this.selectedObject) return;
    const mesh = this.selectedObject.mesh;
    
    this.transform.position.x = Number(mesh.position.x.toFixed(2));
    this.transform.position.y = Number(mesh.position.y.toFixed(2));
    this.transform.position.z = Number(mesh.position.z.toFixed(2));

    this.transform.rotation.x = Number(THREE.MathUtils.radToDeg(mesh.rotation.x).toFixed(2));
    this.transform.rotation.y = Number(THREE.MathUtils.radToDeg(mesh.rotation.y).toFixed(2));
    this.transform.rotation.z = Number(THREE.MathUtils.radToDeg(mesh.rotation.z).toFixed(2));

    this.transform.scale.x = Number(mesh.scale.x.toFixed(2));
    this.transform.scale.y = Number(mesh.scale.y.toFixed(2));
    this.transform.scale.z = Number(mesh.scale.z.toFixed(2));
  }

  public applyTransformChanges(): void {
    if (!this.selectedObject) return;
    const mesh = this.selectedObject.mesh;
    
    mesh.position.set(
      this.transform.position.x,
      this.transform.position.y,
      this.transform.position.z
    );

    mesh.rotation.set(
      THREE.MathUtils.degToRad(this.transform.rotation.x),
      THREE.MathUtils.degToRad(this.transform.rotation.y),
      THREE.MathUtils.degToRad(this.transform.rotation.z)
    );

    mesh.scale.set(
      this.transform.scale.x,
      this.transform.scale.y,
      this.transform.scale.z
    );
    this.saveScene();
  }

  public toggleTransformSpace(): void {
    this.transformSpace = this.transformSpace === 'local' ? 'world' : 'local';
    this.transformControl.setSpace(this.transformSpace);
  }

  public setTransformMode(mode: 'translate' | 'rotate' | 'scale' | 'select'): void {
    this.currentTransformMode = mode;
    if (!this.transformControl) return;

    if (mode === 'select') {
      this.transformControl.detach();
    } else {
      this.transformControl.setMode(mode as any);
      if (this.selectedObject) {
        this.transformControl.attach(this.selectedObject.mesh);
      }
    }
    this.cdr.detectChanges();
  }

  public setShelfAlignment(alignment: 'left' | 'right' | 'justify'): void {
    if (this.selectedObject) {
      const type = this.selectedObject.mesh.userData['type'];
      let shelf: THREE.Object3D | null = null;
      
      if (type === 'shelf') {
        shelf = this.selectedObject.mesh;
      } else if (type === 'bottle') {
        shelf = this.selectedObject.mesh.parent;
      }
      
      if (shelf && shelf.userData['type'] === 'shelf') {
        shelf.userData['alignment'] = alignment;
        this.saveScene();
        this.cdr.detectChanges();
      }
    }
  }

  public toggleSnap(): void {
    this.snapEnabled = !this.snapEnabled;
    this.updateSnapSettings();
  }

  private updateSnapSettings(): void {
    if (!this.transformControl) return;
    if (this.snapEnabled) {
      this.transformControl.setTranslationSnap(0.25);
      this.transformControl.setRotationSnap(THREE.MathUtils.degToRad(15));
      this.transformControl.setScaleSnap(0.1);
    } else {
      this.transformControl.setTranslationSnap(null);
      this.transformControl.setRotationSnap(null);
      this.transformControl.setScaleSnap(null);
    }
  }

  public distributeShelves(): void {
    if (this.contextMenu.targetId && this.contextMenu.targetType === 'cupboard') {
       const cupboard = this.interactableObjects.find(c => c.uuid === this.contextMenu.targetId);
       if (!cupboard) return;

       const shelves = cupboard.children.filter(child => child.userData['type'] === 'shelf');
       if (shelves.length === 0) return;

       const sy = cupboard.scale.y || 1;
       const minY = 0.02 / sy;
       const maxY = 2 - 0.02 / sy;
       const gap = (maxY - minY) / (shelves.length + 1);

       shelves.sort((a, b) => a.position.y - b.position.y);
       
       for (let i = 0; i < shelves.length; i++) {
           shelves[i].position.y = minY + gap * (i + 1);
       }
       
       this.updateTransformViewFromModel();
       this.saveScene();
       this.cdr.detectChanges();
    }
  }

  public duplicateObject(): void {
    if (!this.contextMenu.targetId) return;

    const sourceData = this.findObjectData(this.contextMenu.targetId);
    if (!sourceData) return;

    // Serialize the original object to capture its state, then generate a new UUID
    const serialized = this.serializeObjectList([sourceData])[0];
    const newId = THREE.MathUtils.generateUUID();
    
    serialized.id = newId;
    serialized.name += " (Copy)";
    // Offset the position slightly so the duplicate is visible
    serialized.position.x += 0.2;
    serialized.position.z += 0.2;

    const newObjects = this.deserializeObjectList([serialized]);
    const newObjData = newObjects[0];

    // Handle scene hierarchy and placement in the data list
    const parentMesh = sourceData.mesh.parent;
    if (!parentMesh || parentMesh === this.scene) {
      this.scene.add(newObjData.mesh);
      this.objectDataList.push(newObjData);
    } else {
      parentMesh.add(newObjData.mesh);
      const parentId = parentMesh.userData['rootId'] || parentMesh.uuid;
      const parentData = this.findObjectData(parentId);
      if (parentData) {
        parentData.children = parentData.children || [];
        parentData.children.push(newObjData);
      }
    }

    this.addToInteractableRecursive(newObjData);
    this.saveScene();
    this.selectObjectById(newId);
    this.contextMenu.visible = false;
    this.cdr.detectChanges();
  }

  public deleteObject(): void {
    if (this.contextMenu.targetId) {
       this.removeObjectRecursively(this.contextMenu.targetId);
       this.contextMenu.visible = false;
       this.saveScene();
       this.cdr.detectChanges();
    }
  }

  private removeObjectRecursively(id: string): void {
    // 1. Find and remove from physical scene and interactables
    const meshObj = this.interactableObjects.find(obj => obj.uuid === id);
    if (meshObj) {
      const uuidsToRemove = new Set<string>();
      meshObj.traverse(child => uuidsToRemove.add(child.uuid));
      
      this.interactableObjects = this.interactableObjects.filter(obj => !uuidsToRemove.has(obj.uuid));
      
      if (meshObj.parent) {
         meshObj.parent.remove(meshObj);
      } else {
         this.scene.remove(meshObj);
      }
      
      // If the currently selected object is being deleted (or is a child of what is deleted), clear selection
      if (this.selectedObject && uuidsToRemove.has(this.selectedObject.id)) {
         this.selectObjectById(null);
      }
    }
    
    // 2. Remove from Scene Hierarchy UI
    this.removeFromObjectDataList(id);
  }

  private removeFromObjectDataList(id: string, list: SceneObjectData[] = this.objectDataList): boolean {
    const idx = list.findIndex(item => item.id === id);
    if (idx !== -1) {
      list.splice(idx, 1);
      return true;
    }
    for (const item of list) {
      if (item.children && this.removeFromObjectDataList(id, item.children)) {
        return true;
      }
    }
    return false;
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    if (this.controls) {
      this.controls.update();
    }
    
    this.updateParametricMeshes();

    if (this.viewCubeControls) {
      if (!this.viewCubeControls['_animation']) {
        // The cube represents the scene orientation, which is the inverse of the camera's view rotation
        this.viewCubeControls.setQuaternion(this.camera.quaternion.clone().invert());
      }
      this.viewCubeControls.update();
    }

    if (this.renderer && this.scene && this.camera) {
      this.composer.render();

      if (this.viewCubeScene && this.viewCubeCamera && this.viewCubeRenderer) {
        this.viewCubeRenderer.render(this.viewCubeScene, this.viewCubeCamera);
      }
    }
  };

  private updateParametricMeshes(): void {
    for (const obj of this.interactableObjects) {
       const type = obj.userData['type'];
       const sx = obj.scale.x || 1;
       const sy = obj.scale.y || 1;
       const sz = obj.scale.z || 1;

       if (type === 'cupboard') {
          if (obj.children.length >= 5) {
             (obj.children[0] as THREE.Mesh).scale.set(1 / sx, 1, 1);
             (obj.children[0] as THREE.Mesh).position.set(-0.5 + 0.01 / sx, 1, 0);
             (obj.children[1] as THREE.Mesh).scale.set(1 / sx, 1, 1);
             (obj.children[1] as THREE.Mesh).position.set(0.5 - 0.01 / sx, 1, 0);
             (obj.children[2] as THREE.Mesh).scale.set(1, 1 / sy, 1);
             (obj.children[2] as THREE.Mesh).position.set(0, 2 - 0.01 / sy, 0);
             (obj.children[3] as THREE.Mesh).scale.set(1, 1 / sy, 1);
             (obj.children[3] as THREE.Mesh).position.set(0, 0.01 / sy, 0);
             (obj.children[4] as THREE.Mesh).scale.set(1, 1, 1 / sz);
             (obj.children[4] as THREE.Mesh).position.set(0, 1, -0.25 + 0.005 / sz);
          }
          for (const child of obj.children) {
             if (child.userData['type'] === 'shelf') {
                child.scale.set((sx - 0.04) / sx, 1 / sy, (0.5 * sz - 0.01) / sz);
                child.position.set(0, child.position.y, 0.005 / sz);
             }
          }
       } else if (type === 'door') {
          for (const child of obj.children) {
             if (child.userData['type'] === 'shelf') {
                // Adjust shelf on door: Width = 80% of door width, Depth = 0.15m
                child.scale.set(0.72, 1 / sy, 0.15 / sz);
                child.position.set(0, child.position.y, 0.025 + 0.075 / sz);
             }
          }
       } else if (type === 'shelf') {
          const alignment = obj.userData['alignment'] || 'justify';
          const bottles = obj.children.filter(c => c.userData['type'] === 'bottle');
          
          if (bottles.length > 0) {
             const n = bottles.length;
             for (let i = 0; i < n; i++) {
                const item = bottles[i];
                // Counter-scale so bottles don't stretch with the shelf
                item.scale.set(1 / sx, 1 / sy, 1 / sz);
                
                item.position.y = 0.01 / sy; // Sit on top of the shelf surface
                item.position.z = 0;         // Center of shelf depth
                
                const worldSpacing = 0.12;
                const localSpacing = worldSpacing / sx;

                if (alignment === 'left') {
                   item.position.x = -0.5 + (0.06 / sx) + (i * localSpacing);
                } else if (alignment === 'right') {
                   item.position.x = 0.5 - (0.06 / sx) - ((n - 1 - i) * localSpacing);
                } else {
                   // Justify distribution
                   const spacing = 1.0 / (n + 1);
                   item.position.x = -0.5 + (spacing * (i + 1));
                }
             }
          }
       }
    }
  }

private draggingType: string | null = null;
  private phantomMesh: THREE.Object3D | null = null;
  private canDrop: boolean = true;
  private hoverTarget: THREE.Object3D | null = null;

  // Drag and Drop Logic
  public onDragStart(event: DragEvent, type: string): void {
    this.draggingType = type;
    if (event.dataTransfer) {
      event.dataTransfer.setData('type', type);
      event.dataTransfer.effectAllowed = 'copy';
      
      // Use transparent 1x1 image to hide native HTML ghost
      const dragIcon = new Image();
      dragIcon.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      event.dataTransfer.setDragImage(dragIcon, 0, 0);
    }
  }

  public onDragEnd(event: DragEvent): void {
    this.draggingType = null;
    this.hoverTarget = null;
    this.removePhantom();
  }

  public onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }

    if (!this.draggingType) return;

    const intersect = this.getRaycastIntersection(event);
    if (intersect) {
      // Check if hovering over a cupboard or door
      const targetHit = this.getPlacementTargetIntersection(event);
      
      if (!this.phantomMesh) {
         this.phantomMesh = this.createObject3DOnly(this.draggingType);
         this.scene.add(this.phantomMesh);
      }

      if (targetHit && (this.draggingType === 'shelf' || this.draggingType === 'bottle')) {
         this.positionMeshOnTarget(this.phantomMesh, targetHit, event);
         this.hoverTarget = targetHit;
      } else {
        this.positionMesh(this.phantomMesh, this.draggingType, intersect);
        this.hoverTarget = null;
      }
      
      // Collision checking
      this.canDrop = !this.checkCollision(this.phantomMesh, this.hoverTarget);

      this.phantomMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          const mat = child.material;
          mat.transparent = true;
          mat.opacity = 0.6;
          mat.depthWrite = false;
          // Highlight blue if clear, red if colliding
          mat.color.set(this.canDrop ? '#3b82f6' : '#ef4444');
        }
      });
    }
  }

  public onDragLeave(event: DragEvent): void {
    this.canDrop = true;
    this.hoverTarget = null;
    this.removePhantom();
  }

  public onDrop(event: DragEvent): void {
    event.preventDefault();

    if (this.phantomMesh && this.draggingType && this.canDrop) {
      const type = this.draggingType;
      // We will create a fresh object instead of keeping the phantom to reset properly
      const mesh = this.createObject3DOnly(type);

      if (this.hoverTarget && (type === 'shelf' || type === 'bottle')) {
        // Make placement deterministic in target LOCAL space.
        this.positionMeshOnTarget(mesh, this.hoverTarget, event);

        mesh.userData['rootId'] = mesh.uuid;

        const worldPos = mesh.position.clone();
        this.hoverTarget.add(mesh);
        this.hoverTarget.updateMatrixWorld(true);
        this.hoverTarget.worldToLocal(worldPos);
        mesh.position.copy(worldPos);
        
        // Reset scale so parametric update handles it natively
        mesh.scale.set(1, 1, 1);
      } else {
        if (type === 'shelf') mesh.scale.set(0.8, 1, 0.8);
        this.positionMesh(mesh, type, this.phantomMesh.position.clone());
        mesh.userData['rootId'] = mesh.uuid;
        this.scene.add(mesh);
      }

      // Mark all children to properly select root when raycasted
      mesh.traverse(child => {
        child.userData['rootId'] = mesh.userData['rootId'];
      });

      let name = 'New Object';
      if (type === 'cube') name = 'Standard Cube';
      else if (type === 'shelf') name = 'Rectangle Shelf';
      else if (type === 'cupboard') name = 'Open Cupboard';
      else if (type === 'chest') name = 'Storage Chest';
      else if (type === 'door') name = 'Door';
      else if (type === 'bottle') name = 'Bottle';

      // Add to interactableObjects so nested shelves can be selected/transformed.
      this.interactableObjects.push(mesh);

      const objData: SceneObjectData = { id: mesh.uuid, name: name, mesh: mesh, children: [] };
      if (this.hoverTarget && (type === 'shelf' || type === 'bottle')) {
         const parentData = this.findObjectData(this.hoverTarget.userData['rootId'] || this.hoverTarget.uuid);
         if (parentData) {
            parentData.children = parentData.children || [];
            parentData.children.push(objData);
         } else {
            this.objectDataList.push(objData);
         }
      } else {
         this.objectDataList.push(objData);
      }
      this.saveScene();
      this.selectObjectById(mesh.uuid);
    }

    this.draggingType = null;
    this.hoverTarget = null;
    this.removePhantom();
  }


  private removePhantom(): void {
    if (this.phantomMesh) {
      this.scene.remove(this.phantomMesh);
      this.phantomMesh = null;
    }
  }

  private findObjectData(id: string, list: SceneObjectData[] = this.objectDataList): SceneObjectData | null {
    for (const item of list) {
      if (item.id === id) return item;
      if (item.children && item.children.length > 0) {
        const found = this.findObjectData(id, item.children);
        if (found) return found;
      }
    }
    return null;
  }

  private getRaycastIntersection(event: DragEvent | PointerEvent): THREE.Vector3 | null {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, target);
  }

private checkCollision(meshToTest: THREE.Object3D, ignoreParent: THREE.Object3D | null = null): boolean {
     meshToTest.updateMatrixWorld(true);
     const ghostBox = new THREE.Box3().setFromObject(meshToTest);
     // shrink box slightly to allow side-by-side placing smoothly
     ghostBox.expandByScalar(-0.02);

     for (const obj of this.interactableObjects) {
        if (obj.uuid === meshToTest.uuid) continue;
        // Skip collision check against parent cupboard
        if (ignoreParent && obj === ignoreParent) continue;
        obj.updateMatrixWorld(true);
        const objBox = new THREE.Box3().setFromObject(obj);
        if (ghostBox.intersectsBox(objBox)) {
           return true; // Collision hit
        }
     }
     
// Check collision against other shelves inside the same cupboard
      if (ignoreParent) {
         let hasCollision = false;
         ignoreParent.traverseVisible((child) => {
            if (hasCollision) return;
            if (child.uuid === meshToTest.uuid) return;
            if (child.userData['rootId'] === meshToTest.userData['rootId']) {
               child.updateMatrixWorld(true);
               const siblingBox = new THREE.Box3().setFromObject(child);
               if (ghostBox.intersectsBox(siblingBox)) {
                  hasCollision = true;
                  return; // Stop traversal
               }
            }
         });
         if (hasCollision) return true;
      }
      
      return false;
  }

  private getPlacementTargetIntersection(event: DragEvent | PointerEvent): THREE.Object3D | null {
     const bounds = this.renderer.domElement.getBoundingClientRect();
     this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
     this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
     this.raycaster.setFromCamera(this.mouse, this.camera);

     const targets = this.interactableObjects.filter(obj => 
        obj.userData['type'] === 'cupboard' || obj.userData['type'] === 'door'
     );
     
     if (targets.length === 0) return null;

     const intersects = this.raycaster.intersectObjects(targets, true);
     if (intersects.length > 0) {
        let obj: THREE.Object3D | null = intersects[0].object;
        while (obj && obj.userData['type'] !== 'cupboard' && obj.userData['type'] !== 'door') {
            obj = obj.parent;
        }
        return obj;
     }
     return null;
  }

  private positionMeshOnTarget(mesh: THREE.Object3D, target: THREE.Object3D, event: DragEvent | PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects([target], true);
    let hitY = target.position.y + 1; // Default to middle
    if (intersects.length > 0) {
       hitY = intersects[0].point.y;
    }

    const targetType = target.userData['type'];
    const sx = target.scale.x;
    const sy = target.scale.y;
    const sz = target.scale.z;

    let localZ = 0;
    if (mesh.userData['type'] === 'shelf') {
       if (targetType === 'door') {
          mesh.scale.set(0.72 * sx, 1, 0.15);
          localZ = 0.025 + 0.075 / sz;
       } else {
          mesh.scale.set(sx - 0.04, 1, 0.5 * sz - 0.01);
          localZ = 0.005 / sz;
       }
    } else if (mesh.userData['type'] === 'bottle') {
       // Bottles use fixed size, placement logic in updateParametricMeshes
       const localPos = new THREE.Vector3(0, 0.01, 0);
       localPos.applyMatrix4(target.matrixWorld);
       mesh.position.copy(localPos);
       return; 
    }

    const localPos = new THREE.Vector3(0, 0, localZ);
    localPos.applyMatrix4(target.matrixWorld);

    mesh.position.set(
      localPos.x, // Centered horizontally in cupboard
      Math.max(target.position.y + 0.01, Math.min(target.position.y + (2 * sy) - 0.01, hitY)),
      localPos.z // Snapped to back
    );
  }


  private createObject3DOnly(type: string): THREE.Object3D {
     const applyShadowFlags = (obj: THREE.Object3D): void => {
       obj.traverse((child) => {
         if (child instanceof THREE.Mesh) {
           child.castShadow = true;
           child.receiveShadow = true;
         }
       });
     };

     if (type === 'door') {
       // Simple door leaf (box) centered at origin; snapping will align edge-to-edge.
       const geometry = new THREE.BoxGeometry(0.9, 2, 0.05);
       const material = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.25, metalness: 0.3 });
       const mesh = new THREE.Mesh(geometry, material);
       mesh.userData['type'] = 'door';
       applyShadowFlags(mesh);
       return mesh;
     }

     if (type === 'cupboard') {
       const group = new THREE.Group();
       group.userData['type'] = 'cupboard';
       
       const material = new THREE.MeshStandardMaterial({ color: '#a8a8a8', roughness: 0.3, metalness: 0.1 });
       
       const left = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2, 0.5), material);
       left.position.set(-0.49, 1, 0); 
       
       const right = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2, 0.5), material);
       right.position.set(0.49, 1, 0);
       
       const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.5), material);
       top.position.set(0, 1.99, 0);
       
       const bottom = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.5), material);
       bottom.position.set(0, 0.01, 0);
       
       const back = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.01), material);
       back.position.set(0, 1, -0.245);
       
       group.add(left, right, top, bottom, back);
       // Ensure all cupboard parts cast/receive shadows.
       // Ensure all cupboard parts cast/receive shadows.
       applyShadowFlags(group);
       return group;
     }

    if (type === 'bottle') {
      const group = new THREE.Group();
      group.userData['type'] = 'bottle';
      const mat = new THREE.MeshStandardMaterial({ color: '#34d399', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15), mat);
      body.position.y = 0.075;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05), mat);
      neck.position.y = 0.175;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.01), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
      cap.position.y = 0.2;
      group.add(body, neck, cap);
      applyShadowFlags(group);
      return group;
    }

     let geometry: THREE.BufferGeometry;
     let materialColor = '#38bdf8';
     
     if (type === 'shelf') {
       geometry = new THREE.BoxGeometry(1, 0.02, 1);
       materialColor = '#8b5cf6';
     } else if (type === 'chest') {
       geometry = new THREE.BoxGeometry(1, 0.1, 0.6);
       materialColor = '#ffc2c2';
     } else {
       geometry = new THREE.BoxGeometry(1, 1, 1);
       materialColor = '#38bdf8';
     }

     const material = new THREE.MeshStandardMaterial({ 
       color: materialColor, roughness: 0.2, metalness: 0.5 
     });
     const mesh = new THREE.Mesh(geometry, material);
     mesh.userData['type'] = type;
     applyShadowFlags(mesh);
     return mesh;
  }

  private moveObjectInDataList(childId: string, newParentId: string): void {
    const childData = this.findObjectData(childId);
    if (!childData) return;

    this.removeFromObjectDataList(childId);

    const parentData = this.findObjectData(newParentId);
    if (parentData) {
      parentData.children = parentData.children || [];
      parentData.children.push(childData);
    } else {
      this.objectDataList.push(childData);
    }
  }

  private snapShelfToTarget(): void {
    const shelf = this.selectedObject?.mesh;
    if (!shelf || shelf.userData['type'] !== 'shelf') return;

    shelf.updateMatrixWorld(true);
    const shelfBox = new THREE.Box3().setFromObject(shelf);
    
    // Filter potential parent targets (Cupboards and Doors)
    const targets = this.interactableObjects.filter(obj => 
      (obj.userData['type'] === 'cupboard' || obj.userData['type'] === 'door') && obj !== shelf
    );

    let targetParent: THREE.Object3D | null = null;
    for (const target of targets) {
      target.updateMatrixWorld(true);
      const targetBox = new THREE.Box3().setFromObject(target);
      if (shelfBox.intersectsBox(targetBox)) {
        targetParent = target;
        break;
      }
    }

    const currentParent = shelf.parent;
    if (targetParent && targetParent !== currentParent) {
      const worldPos = new THREE.Vector3();
      shelf.getWorldPosition(worldPos);

      targetParent.add(shelf);
      targetParent.updateMatrixWorld(true);
      targetParent.worldToLocal(worldPos);
      shelf.position.copy(worldPos);
      
      if (targetParent.userData['type'] === 'door') {
        shelf.quaternion.set(0, 0, 0, 1);
      }

      this.moveObjectInDataList(shelf.uuid, targetParent.uuid);
      this.transformControl.attach(shelf);
    }
  }

  private snapDoors(): void {
    // Snap doors that are close and similarly oriented.
    const doors = this.interactableObjects.filter(o => o.userData['type'] === 'door');
    if (doors.length < 2) return;

    // Only snap if the user is currently manipulating a door (prevents jitter).
    const moving = this.selectedObject?.mesh;
    if (!moving || moving.userData['type'] !== 'door') return;

    // World-space boxes for robust edge matching.
    moving.updateMatrixWorld(true);

    const movingBox = new THREE.Box3().setFromObject(moving);
    const eps = 0.15; // snapping threshold in world units

    // Door orientation: since the door leaf is a flat box, we align by its normal axis.
    // We consider local Z (box thickness axis) after rotation.
    const movingWorldNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(moving.quaternion).normalize();

    let best: { other: THREE.Object3D; snapAxis: 'x' | 'z'; dist: number } | null = null;

    for (const other of doors) {
      if (other === moving) continue;
      other.updateMatrixWorld(true);

      const otherBox = new THREE.Box3().setFromObject(other);

      // Rotation compatibility: normals should be nearly the same (or opposite) => same facing.
      const dot = Math.abs(movingWorldNormal.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(other.quaternion).normalize()));
      if (dot < 0.9) continue;

      // Candidate snap along X or Z based on edge proximity.
      const dx1 = Math.abs(movingBox.min.x - otherBox.max.x);
      const dx2 = Math.abs(movingBox.max.x - otherBox.min.x);
      const dz1 = Math.abs(movingBox.min.z - otherBox.max.z);
      const dz2 = Math.abs(movingBox.max.z - otherBox.min.z);

      const bestXDist = Math.min(dx1, dx2);
      const bestZDist = Math.min(dz1, dz2);

      if (bestXDist < bestZDist) {
        if (bestXDist < eps) {
          best = { other, snapAxis: 'x', dist: bestXDist };
          break;
        }
      } else {
        if (bestZDist < eps) {
          best = { other, snapAxis: 'z', dist: bestZDist };
          break;
        }
      }
    }

    if (!best) return;

    const other = best.other;

    // Align rotation: match full rotation so doors stay consistent.
    moving.quaternion.copy(other.quaternion);

    // Snap position: move moving door so its nearest side touches other's nearest side.
    const movingBox2 = new THREE.Box3().setFromObject(moving);
    const otherBox2 = new THREE.Box3().setFromObject(other);

    const pos = moving.position.clone();

    if (best.snapAxis === 'x') {
      // Determine which sides are closest (min-to-max vs max-to-min)
      const distMinToMax = Math.abs(movingBox2.min.x - otherBox2.max.x);
      const distMaxToMin = Math.abs(movingBox2.max.x - otherBox2.min.x);

      if (distMinToMax <= distMaxToMin) {
        const targetMinX = otherBox2.max.x;
        const delta = targetMinX - movingBox2.min.x;
        pos.x += delta;
      } else {
        const targetMaxX = otherBox2.min.x;
        const delta = targetMaxX - movingBox2.max.x;
        pos.x += delta;
      }
    } else {
      const distMinToMax = Math.abs(movingBox2.min.z - otherBox2.max.z);
      const distMaxToMin = Math.abs(movingBox2.max.z - otherBox2.min.z);

      if (distMinToMax <= distMaxToMin) {
        const targetMinZ = otherBox2.max.z;
        const delta = targetMinZ - movingBox2.min.z;
        pos.z += delta;
      } else {
        const targetMaxZ = otherBox2.min.z;
        const delta = targetMaxZ - movingBox2.max.z;
        pos.z += delta;
      }
    }

    moving.position.copy(pos);
    moving.updateMatrixWorld(true);
  }

  private snapCupboardToDoors(): void {
    // Snap cupboard corners to door corners if they are close and oriented similarly.
    const doors = this.interactableObjects.filter(o => o.userData['type'] === 'door');
    if (doors.length === 0) return;

    const moving = this.selectedObject?.mesh;
    if (!moving || moving.userData['type'] !== 'cupboard') return;

    moving.updateMatrixWorld(true);
    const movingBox = new THREE.Box3().setFromObject(moving);
    const eps = 0.3; // Distance threshold for snapping

    const movingWorldNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(moving.quaternion).normalize();

    let bestDoor: THREE.Object3D | null = null;
    let bestDist = Infinity;
    let bestDoorCorner: THREE.Vector3 | null = null;

    for (const door of doors) {
      door.updateMatrixWorld(true);
      const doorBox = new THREE.Box3().setFromObject(door);

      // Check if they have similar facing orientation
      const doorNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(door.quaternion).normalize();
      if (Math.abs(movingWorldNormal.dot(doorNormal)) < 0.9) continue;

      // Define corners in 2D (XZ plane)
      const mCorners = [
        new THREE.Vector3(movingBox.min.x, 0, movingBox.min.z),
        new THREE.Vector3(movingBox.min.x, 0, movingBox.max.z),
        new THREE.Vector3(movingBox.max.x, 0, movingBox.min.z),
        new THREE.Vector3(movingBox.max.x, 0, movingBox.max.z)
      ];
      const dCorners = [
        new THREE.Vector3(doorBox.min.x, 0, doorBox.min.z),
        new THREE.Vector3(doorBox.min.x, 0, doorBox.max.z),
        new THREE.Vector3(doorBox.max.x, 0, doorBox.min.z),
        new THREE.Vector3(doorBox.max.x, 0, doorBox.max.z)
      ];

      for (const mc of mCorners) {
        for (const dc of dCorners) {
          const d = mc.distanceTo(dc);
          if (d < eps && d < bestDist) {
            bestDist = d;
            bestDoor = door;
            bestDoorCorner = dc;
          }
        }
      }
    }

    if (bestDoor && bestDoorCorner) {
      // Align rotation to match door
      moving.quaternion.copy(bestDoor.quaternion);
      moving.updateMatrixWorld(true);

      // Align the closest cupboard corner to the targeted door corner after rotation match
      const movingBox2 = new THREE.Box3().setFromObject(moving);
      const mCorners2 = [
        new THREE.Vector3(movingBox2.min.x, 0, movingBox2.min.z),
        new THREE.Vector3(movingBox2.min.x, 0, movingBox2.max.z),
        new THREE.Vector3(movingBox2.max.x, 0, movingBox2.min.z),
        new THREE.Vector3(movingBox2.max.x, 0, movingBox2.max.z)
      ];

      let closestMC = mCorners2[0];
      let minD = mCorners2[0].distanceTo(bestDoorCorner);
      for (let i = 1; i < mCorners2.length; i++) {
        const d = mCorners2[i].distanceTo(bestDoorCorner);
        if (d < minD) {
          minD = d;
          closestMC = mCorners2[i];
        }
      }

      moving.position.x += (bestDoorCorner.x - closestMC.x);
      moving.position.z += (bestDoorCorner.z - closestMC.z);
      moving.updateMatrixWorld(true);
    }
  }

  private positionMesh(mesh: THREE.Object3D, type: string, position: THREE.Vector3): void {
     if (type === 'cupboard') {
        mesh.position.set(position.x, 0, position.z); // Because cupboard meshes are already translated up by 1 and half
     } else if (type === 'chest') {
        mesh.position.set(position.x, 0.4, position.z);
     } else if (type === 'shelf') {
        mesh.position.set(position.x, 1.5, position.z);
     } else {
        mesh.position.set(position.x, 0.5, position.z);
     }
  }

  private saveScene(): void {
    if (!this.isBrowser) return;
    const serializedData = this.serializeObjectList(this.objectDataList);
    localStorage.setItem('planogramData', JSON.stringify(serializedData));
  }

  private serializeObjectList(list: SceneObjectData[]): any[] {
    return list.map(item => ({
      id: item.id,
      name: item.name,
      type: item.mesh.userData['type'],
      visible: item.mesh.visible,
      position: { x: item.mesh.position.x, y: item.mesh.position.y, z: item.mesh.position.z },
      rotation: { x: item.mesh.rotation.x, y: item.mesh.rotation.y, z: item.mesh.rotation.z },
      scale: { x: item.mesh.scale.x, y: item.mesh.scale.y, z: item.mesh.scale.z },
      userData: { ...item.mesh.userData },
      children: item.children ? this.serializeObjectList(item.children) : []
    }));
  }

  private loadScene(): void {
    if (!this.isBrowser) return;
    const dataStr = localStorage.getItem('planogramData');
    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      this.interactableObjects = [];
      this.objectDataList = this.deserializeObjectList(data);
      this.rebuildScene(this.objectDataList);
      this.cdr.detectChanges();
    } catch (e) {
      console.error('Failed to load planogram data from local storage', e);
    }
  }

  private deserializeObjectList(data: any[]): SceneObjectData[] {
    return data.map(item => {
      const mesh = this.createObject3DOnly(item.type);
      (mesh as any).uuid = item.id; // Restore identity
      mesh.position.set(item.position.x, item.position.y, item.position.z);
      mesh.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
      mesh.scale.set(item.scale.x, item.scale.y, item.scale.z);
      mesh.visible = item.visible !== undefined ? item.visible : true;
      
      Object.assign(mesh.userData, item.userData);
      mesh.userData['rootId'] = item.id;
      if (!mesh.userData['rootId']) {
        mesh.userData['rootId'] = item.id;
      }
      
      mesh.traverse(child => {
        if (!child.userData['rootId']) child.userData['rootId'] = item.id;
      });

      const childrenData = item.children ? this.deserializeObjectList(item.children) : [];
      
      childrenData.forEach(child => {
        mesh.add(child.mesh);
        // Ensure children know who their root is for raycasting
        child.mesh.traverse(c => c.userData['rootId'] = item.id);
      });

      return {
        id: item.id,
        name: item.name,
        mesh: mesh,
        children: childrenData
      };
    });
  }

  private rebuildScene(list: SceneObjectData[]): void {
    list.forEach(item => {
      if (!item.mesh.parent) {
        this.scene.add(item.mesh);
      }
      this.addToInteractableRecursive(item);
    });
  }

  private addToInteractableRecursive(data: SceneObjectData): void {
    this.interactableObjects.push(data.mesh);
    data.children?.forEach(child => this.addToInteractableRecursive(child));
  }
}

const MAINCOLOR = 0xDDDDDD;
const ACCENTCOLOR = 0XF2F5CE;
const OUTLINECOLOR = 0xCCCCCC;
const toRad = Math.PI / 180;
const TWOPI = 2 * Math.PI;

const FACES = {
  TOP: 1, FRONT: 2, RIGHT: 3, BACK: 4, LEFT: 5, BOTTOM: 6,
  TOP_FRONT_EDGE: 7, TOP_RIGHT_EDGE: 8, TOP_BACK_EDGE: 9, TOP_LEFT_EDGE: 10,
  FRONT_RIGHT_EDGE: 11, BACK_RIGHT_EDGE: 12, BACK_LEFT_EDGE: 13, FRONT_LEFT_EDGE: 14,
  BOTTOM_FRONT_EDGE: 15, BOTTOM_RIGHT_EDGE: 16, BOTTOM_BACK_EDGE: 17, BOTTOM_LEFT_EDGE: 18,
  TOP_FRONT_RIGHT_CORNER: 19, TOP_BACK_RIGHT_CORNER: 20, TOP_BACK_LEFT_CORNER: 21, TOP_FRONT_LEFT_CORNER: 22,
  BOTTOM_FRONT_RIGHT_CORNER: 23, BOTTOM_BACK_RIGHT_CORNER: 24, BOTTOM_BACK_LEFT_CORNER: 25, BOTTOM_FRONT_LEFT_CORNER: 26
};

class ViewCubeControls extends THREE.EventDispatcher<any> {
  cubeSize: number; edgeSize: number; domElement: HTMLElement; _cube: ViewCube; _camera: THREE.Camera; _animation: any;
  constructor(camera: THREE.Camera, cubeSize = 30, edgeSize = 5, domElement: HTMLElement) {
    super();
    this.cubeSize = cubeSize; this.edgeSize = edgeSize; this.domElement = domElement;
    this._cube = new ViewCube({ size: this.cubeSize, edge: this.edgeSize, outline: true, bgColor: MAINCOLOR, hoverColor: ACCENTCOLOR, outlineColor: OUTLINECOLOR });
    this._camera = camera; this._animation = null;
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handleMouseClick = this._handleMouseClick.bind(this);
    this._listen();
  }
  _listen() {
    this.domElement.addEventListener('mousemove', this._handleMouseMove);
    this.domElement.addEventListener('click', this._handleMouseClick);
  }
  _handleMouseClick(event: MouseEvent) {
    const x = (event.offsetX / (event.target as HTMLElement).clientWidth) * 2 - 1;
    const y = -(event.offsetY / (event.target as HTMLElement).clientHeight) * 2 + 1;
    this._checkSideTouch(x, y);
  }
  _checkSideTouch(x: number, y: number) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this._camera);
    const intersects = raycaster.intersectObjects(this._cube.children, true);
    if (intersects.length) {
      for (let { object } of intersects) {
        if (object.name) { this._rotateTheCube(Number(object.name)); break; }
      }
    }
  }
  _rotateTheCube(side: number) {
    switch (side) {
      case FACES.FRONT: this._setCubeAngles(0, 0, 0); break;
      case FACES.RIGHT: this._setCubeAngles(0, -90, 0); break;
      case FACES.BACK: this._setCubeAngles(0, -180, 0); break;
      case FACES.LEFT: this._setCubeAngles(0, -270, 0); break;
      case FACES.TOP: this._setCubeAngles(90, 0, 0); break;
      case FACES.BOTTOM: this._setCubeAngles(-90, 0, 0); break;
      case FACES.TOP_FRONT_EDGE: this._setCubeAngles(45, 0, 0); break;
      case FACES.TOP_RIGHT_EDGE: this._setCubeAngles(45, -90, 0); break;
      case FACES.TOP_BACK_EDGE: this._setCubeAngles(45, -180, 0); break;
      case FACES.TOP_LEFT_EDGE: this._setCubeAngles(45, -270, 0); break;
      case FACES.BOTTOM_FRONT_EDGE: this._setCubeAngles(-45, 0, 0); break;
      case FACES.BOTTOM_RIGHT_EDGE: this._setCubeAngles(-45, -90, 0); break;
      case FACES.BOTTOM_BACK_EDGE: this._setCubeAngles(-45, -180, 0); break;
      case FACES.BOTTOM_LEFT_EDGE: this._setCubeAngles(-45, -270, 0); break;
      case FACES.FRONT_RIGHT_EDGE: this._setCubeAngles(0, -45, 0); break;
      case FACES.BACK_RIGHT_EDGE: this._setCubeAngles(0, -135, 0); break;
      case FACES.BACK_LEFT_EDGE: this._setCubeAngles(0, -225, 0); break;
      case FACES.FRONT_LEFT_EDGE: this._setCubeAngles(0, -315, 0); break;
      case FACES.TOP_FRONT_RIGHT_CORNER: this._setCubeAngles(45, -45, 0); break;
      case FACES.TOP_BACK_RIGHT_CORNER: this._setCubeAngles(45, -135, 0); break;
      case FACES.TOP_BACK_LEFT_CORNER: this._setCubeAngles(45, -225, 0); break;
      case FACES.TOP_FRONT_LEFT_CORNER: this._setCubeAngles(45, -315, 0); break;
      case FACES.BOTTOM_FRONT_RIGHT_CORNER: this._setCubeAngles(-45, -45, 0); break;
      case FACES.BOTTOM_BACK_RIGHT_CORNER: this._setCubeAngles(-45, -135, 0); break;
      case FACES.BOTTOM_BACK_LEFT_CORNER: this._setCubeAngles(-45, -225, 0); break;
      case FACES.BOTTOM_FRONT_LEFT_CORNER: this._setCubeAngles(-45, -315, 0); break;
    }
  }
  _setCubeAngles(x: number, y: number, z: number) {
    const base = this._cube.rotation;
    this._animation = {
      base: { x: base.x, y: base.y, z: base.z },
      delta: { x: calculateAngleDelta(base.x, x * toRad), y: calculateAngleDelta(base.y, y * toRad), z: calculateAngleDelta(base.z, z * toRad) },
      duration: 500, time: Date.now()
    };
  }
  _handleMouseMove(event: MouseEvent) {
    const x = (event.offsetX / (event.target as HTMLElement).clientWidth) * 2 - 1;
    const y = -(event.offsetY / (event.target as HTMLElement).clientHeight) * 2 + 1;
    this._checkSideOver(x, y);
  }
  _checkSideOver(x: number, y: number) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this._camera);
    const intersects = raycaster.intersectObjects(this._cube.children, true);
    this._cube.traverse((obj: any) => { if (obj.name) obj.material.color.setHex(MAINCOLOR); });
    if (intersects.length) {
      for (let { object } of intersects) {
        if (object.name) {
          object.parent?.children.forEach((child: any) => {
            if (child.name === object.name) child.material.color.setHex(ACCENTCOLOR);
          });
          break;
        }
      }
    }
  }
  update() { this._animate(); }
  _animate() {
    if (!this._animation) return;
    const now = Date.now(); const { duration, time } = this._animation;
    const alpha = Math.min(((now - time) / duration), 1);
    this._animateCubeRotation(this._animation, alpha);
    if (alpha == 1) this._animation = null;
    this.dispatchEvent({ type: 'angle-change', quaternion: this._cube.quaternion.clone() } as any);
  }
  _animateCubeRotation({ base, delta }: any, alpha: number) {
    const ease = (Math.sin(((alpha * 2) - 1) * Math.PI * 0.5) + 1) * 0.5;
    let angleX = -TWOPI + base.x + delta.x * ease;
    let angleY = -TWOPI + base.y + delta.y * ease;
    let angleZ = -TWOPI + base.z + delta.z * ease;
    this._cube.rotation.set(angleX % TWOPI, angleY % TWOPI, angleZ % TWOPI);
  }
  setQuaternion(quaternion: THREE.Quaternion) { this._cube.setRotationFromQuaternion(quaternion); }
  getObject() { return this._cube; }
  _dispose() {
    this.domElement.removeEventListener('mousemove', this._handleMouseMove);
    this.domElement.removeEventListener('click', this._handleMouseClick);
  }
}

class ViewCube extends THREE.Object3D {
  _cubeSize: number; _edgeSize: number; _outline: boolean; _bgColor: number; _hoverColor: number; _outlineColor: number;
  constructor({ size = 60, edge = 5, outline = true, bgColor = 0xCCCCCC, hoverColor = 0xFFFFFF, outlineColor = 0x999999 }) {
    super();
    this._cubeSize = size; this._edgeSize = edge; this._outline = outline; this._bgColor = bgColor; this._hoverColor = hoverColor; this._outlineColor = outlineColor;
    this._build();
  }
  _build() {
    const faceSize = this._cubeSize - this._edgeSize * 2;
    const faceOffset = this._cubeSize / 2;
    const borderSize = this._edgeSize;
    const cubeFaces = this._createCubeFaces(faceSize, faceOffset);
    for (let [i, props] of BOX_FACES.entries()) {
      (cubeFaces.children[i] as THREE.Mesh).name = String(props.name);
      ((cubeFaces.children[i] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(this._bgColor);
      ((cubeFaces.children[i] as THREE.Mesh).material as THREE.MeshBasicMaterial).map = props.map;
    }
    this.add(cubeFaces);
    const corners: THREE.Object3D[] = [];
    for (let [i, props] of CORNER_FACES.entries()) {
      const corner = this._createCornerFaces(borderSize, faceOffset, String(props.name), { color: this._bgColor });
      corner.rotateOnAxis(new THREE.Vector3(0, 1, 0), (i % 4) * 90 * toRad);
      corners.push(corner);
    }
    this.add(new THREE.Group().add(...corners.slice(0, 4)));
    this.add(new THREE.Group().add(...corners.slice(4)).rotateOnAxis(new THREE.Vector3(1, 0, 0), 180 * toRad));
    const edges: THREE.Object3D[] = [];
    for (let [i, props] of EDGE_FACES.entries()) {
      const edge = this._createHorzEdgeFaces(faceSize, borderSize, faceOffset, String(props.name), { color: this._bgColor });
      edge.rotateOnAxis(new THREE.Vector3(0, 1, 0), (i % 4) * 90 * toRad);
      edges.push(edge);
    }
    this.add(new THREE.Group().add(...edges.slice(0, 4)));
    this.add(new THREE.Group().add(...edges.slice(4)).rotateOnAxis(new THREE.Vector3(1, 0, 0), 180 * toRad));
    const sideEdges = new THREE.Group();
    for (let [i, props] of EDGE_FACES_SIDE.entries()) {
      const edge = this._createVertEdgeFaces(borderSize, faceSize, faceOffset, String(props.name), { color: this._bgColor });
      edge.rotateOnAxis(new THREE.Vector3(0, 1, 0), i * 90 * toRad);
      sideEdges.add(edge);
    }
    this.add(sideEdges);
    if (this._outline) this.add(this._createCubeOutline(this._cubeSize));
  }
  _createFace(size: any, position: any, { axis = [0, 1, 0], angle = 0, name = "", matProps = {} } = {}) {
    if (!Array.isArray(size)) size = [size, size];
    const material = new THREE.MeshBasicMaterial(matProps);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
    face.name = name; face.rotateOnAxis(new THREE.Vector3(axis[0], axis[1], axis[2]), angle * toRad);
    face.position.set(position[0], position[1], position[2]);
    return face;
  }
  _createCubeFaces(faceSize: number, offset: number) {
    const faces = new THREE.Object3D();
    faces.add(this._createFace(faceSize, [0, 0, offset], { axis: [0, 1, 0], angle: 0 }));
    faces.add(this._createFace(faceSize, [offset, 0, 0], { axis: [0, 1, 0], angle: 90 }));
    faces.add(this._createFace(faceSize, [0, 0, -offset], { axis: [0, 1, 0], angle: 180 }));
    faces.add(this._createFace(faceSize, [-offset, 0, 0], { axis: [0, 1, 0], angle: 270 }));
    faces.add(this._createFace(faceSize, [0, offset, 0], { axis: [1, 0, 0], angle: -90 }));
    faces.add(this._createFace(faceSize, [0, -offset, 0], { axis: [1, 0, 0], angle: 90 }));
    return faces;
  }
  _createCornerFaces(faceSize: number, offset: number, name = "", matProps = {}) {
    const corner = new THREE.Object3D(); const borderOffset = offset - faceSize / 2;
    corner.add(this._createFace(faceSize, [borderOffset, borderOffset, offset], { axis: [0, 1, 0], angle: 0, matProps, name }));
    corner.add(this._createFace(faceSize, [offset, borderOffset, borderOffset], { axis: [0, 1, 0], angle: 90, matProps, name }));
    corner.add(this._createFace(faceSize, [borderOffset, offset, borderOffset], { axis: [1, 0, 0], angle: -90, matProps, name }));
    return corner;
  }
  _createHorzEdgeFaces(w: number, h: number, offset: number, name = "", matProps = {}) {
    const edge = new THREE.Object3D(); const borderOffset = offset - h / 2;
    edge.add(this._createFace([w, h], [0, borderOffset, offset], { axis: [0, 1, 0], angle: 0, name, matProps }));
    edge.add(this._createFace([w, h], [0, offset, borderOffset], { axis: [1, 0, 0], angle: -90, name, matProps }));
    return edge;
  }
  _createVertEdgeFaces(w: number, h: number, offset: number, name = "", matProps = {}) {
    const edge = new THREE.Object3D(); const borderOffset = offset - w / 2;
    edge.add(this._createFace([w, h], [borderOffset, 0, offset], { axis: [0, 1, 0], angle: 0, name, matProps }));
    edge.add(this._createFace([w, h], [offset, 0, borderOffset], { axis: [0, 1, 0], angle: 90, name, matProps }));
    return edge;
  }
  _createCubeOutline(size: number) {
    const wireframe = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), new THREE.LineBasicMaterial({ color: this._outlineColor }));
    return wireframe;
  }
}

function calculateAngleDelta(from: number, to: number) {
  const direct = to - from; const altA = direct - TWOPI; const altB = direct + TWOPI;
  return Math.abs(direct) > Math.abs(altA) ? altA : (Math.abs(direct) > Math.abs(altB) ? altB : direct);
}

function createTextSprite(text: string, props: any): THREE.Texture | null {
  if (typeof document === 'undefined') return null;

  const fontface = props.font || 'Helvetica'; const fontsize = props.fontSize || 30;
  const width = props.width || 200; const height = props.height || 200;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = "rgba(255, 255, 255, 1.0)"; context.fillRect(0, 0, width, height);
  context.font = `bold ${fontsize}px ${fontface}`;
  context.fillStyle = "rgba(0, 0, 0, 1.0)";
  const metrics = context.measureText(text); const textWidth = metrics.width;
  context.fillText(text, width / 2 - textWidth / 2, height / 2 + fontsize / 2 - 2);
  const texture = new THREE.Texture(canvas); texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

const BOX_FACES = [
  { name: FACES.FRONT, map: createTextSprite("FRONT", { fontSize: 60, font: "Arial Narrow, sans-serif" }) },
  { name: FACES.RIGHT, map: createTextSprite("RIGHT", { fontSize: 60, font: "Arial Narrow, sans-serif" }) },
  { name: FACES.BACK, map: createTextSprite("BACK", { fontSize: 60, font: "Arial Narrow, sans-serif" }) },
  { name: FACES.LEFT, map: createTextSprite("LEFT", { fontSize: 60, font: "Arial Narrow, sans-serif" }) },
  { name: FACES.TOP, map: createTextSprite("TOP", { fontSize: 60, font: "Arial Narrow, sans-serif" }) },
  { name: FACES.BOTTOM, map: createTextSprite("BOTTOM", { fontSize: 60, font: "Arial Narrow, sans-serif" }) }
];
const CORNER_FACES = [
  { name: FACES.TOP_FRONT_RIGHT_CORNER }, { name: FACES.TOP_BACK_RIGHT_CORNER }, { name: FACES.TOP_BACK_LEFT_CORNER }, { name: FACES.TOP_FRONT_LEFT_CORNER },
  { name: FACES.BOTTOM_BACK_RIGHT_CORNER }, { name: FACES.BOTTOM_FRONT_RIGHT_CORNER }, { name: FACES.BOTTOM_FRONT_LEFT_CORNER }, { name: FACES.BOTTOM_BACK_LEFT_CORNER }
];
const EDGE_FACES = [
  { name: FACES.TOP_FRONT_EDGE }, { name: FACES.TOP_RIGHT_EDGE }, { name: FACES.TOP_BACK_EDGE }, { name: FACES.TOP_LEFT_EDGE },
  { name: FACES.BOTTOM_BACK_EDGE }, { name: FACES.BOTTOM_RIGHT_EDGE }, { name: FACES.BOTTOM_FRONT_EDGE }, { name: FACES.BOTTOM_LEFT_EDGE },
];
const EDGE_FACES_SIDE = [
  { name: FACES.FRONT_RIGHT_EDGE }, { name: FACES.BACK_RIGHT_EDGE }, { name: FACES.BACK_LEFT_EDGE }, { name: FACES.FRONT_LEFT_EDGE }
];
const CUBE_FACES = [...BOX_FACES, ...CORNER_FACES, ...EDGE_FACES, ...EDGE_FACES_SIDE];
