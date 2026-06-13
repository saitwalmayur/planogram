import { Component, AfterViewInit, ElementRef, ViewChild, OnDestroy, HostListener, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { PropertiesPanelComponent } from './properties-panel/properties-panel.component';

interface SceneObjectData {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  children?: SceneObjectData[];
}

@Component({
  selector: 'app-planogram',
  imports: [CommonModule, FormsModule, PropertiesPanelComponent],
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

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private interactableObjects: THREE.Object3D[] = [];

  // State
  public selectedObject: SceneObjectData | null = null;
  public objectDataList: SceneObjectData[] = [];
  public transformSpace: 'local' | 'world' = 'local';
  
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

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private cdr: ChangeDetectorRef
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit(): void {
    if (this.isBrowser) {
      this.initThreeJsScene();
      
      // Bind click handler specifically to canvas
      this.renderer.domElement.addEventListener('click', this.onPointerDown.bind(this));
      this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu.bind(this));
      
      this.animate();

      // Force layout resize explicitly in case flexbox computed elements dynamically (fixes 0x0 canvas bug)
      setTimeout(() => {
        this.onWindowResize();
      }, 50);
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      if (this.animationId !== 0) {
        cancelAnimationFrame(this.animationId);
      }
      if (this.renderer) {
        this.renderer.domElement.removeEventListener('click', this.onPointerDown.bind(this));
        this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu.bind(this));
        this.renderer.dispose();
      }
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.isBrowser && this.camera && this.renderer) {
      const container = this.canvasContainer.nativeElement;
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!this.isBrowser || !this.transformControl) return;
    
    switch (event.key.toLowerCase()) {
      case 'w':
        this.transformControl.setMode('translate');
        break;
      case 'e':
        this.transformControl.setMode('scale');
        break;
      case 'r':
        this.transformControl.setMode('rotate');
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
    container.appendChild(this.renderer.domElement);

    // TransformControls setup
    this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControl.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControl.addEventListener('change', () => {
      if (this.selectedObject) {
         this.updateTransformViewFromModel();
         this.cdr.detectChanges();
      }
    });
    this.scene.add(this.transformControl.getHelper());

    // Initial space
    this.transformControl.setSpace(this.transformSpace);

    // Initial light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x475569, 0x334155);
    this.scene.add(gridHelper);

    // Cube
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ 
      color: '#38bdf8', 
      roughness: 0.2, 
      metalness: 0.5 
    });

    this.rootCube = new THREE.Mesh(geometry, material);
    this.rootCube.userData['rootId'] = this.rootCube.uuid;
    this.rootCube.position.set(0, 0.5, 0); // place it logically on grid
    this.scene.add(this.rootCube);
    
    // Register interactable
    this.interactableObjects.push(this.rootCube);
    this.objectDataList.push({
      id: this.rootCube.uuid,
      name: 'Standard Cube',
      mesh: this.rootCube,
      children: []
    });

    // OrbitControls setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // TransformControls setup
    this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControl.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControl.addEventListener('change', () => {
      if (this.selectedObject) {
         this.updateTransformViewFromModel();
         this.cdr.detectChanges();
      }
    });
    this.scene.add(this.transformControl.getHelper()); // Note: Using getHelper() to add the visual gizmo to the scene
  }

  private onPointerDown(event: PointerEvent): void {
    // Prevent deselection if hovering over transform gizmo
    if (this.transformControl.axis !== null) {
      return;
    }

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactableObjects, true);

    if (intersects.length > 0) {
      const firstHit = intersects[0].object;
      const rootId = firstHit.userData['rootId'] || firstHit.uuid;
      this.selectObjectById(rootId);
    } else {
      this.selectObjectById(null);
    }
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (!this.isBrowser || this.transformControl.axis !== null) return;

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

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
    }
  }

  public selectObjectById(id: string | null): void {
    // Reset color for previous
    if (this.selectedObject) {
      this.selectedObject.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissive.setHex(0x000000);
        }
      });
    }
    
    if (id) {
      this.selectedObject = this.findObjectData(id) || null;
    } else {
      this.selectedObject = null;
    }
    
    // Highlight current selected and attach gizmo
    if (this.selectedObject) {
      this.selectedObject.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissive.setHex(0x111111);
        }
      });
      this.transformControl.attach(this.selectedObject.mesh);
      this.updateTransformViewFromModel();
    } else {
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
  }

  public toggleTransformSpace(): void {
    this.transformSpace = this.transformSpace === 'local' ? 'world' : 'local';
    this.transformControl.setSpace(this.transformSpace);
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
       this.cdr.detectChanges();
    }
  }

  public deleteObject(): void {
    if (this.contextMenu.targetId) {
       this.removeObjectRecursively(this.contextMenu.targetId);
       this.contextMenu.visible = false;
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

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private updateParametricMeshes(): void {
    for (const obj of this.interactableObjects) {
       if (obj.userData['type'] === 'cupboard') {
          const sx = obj.scale.x || 1;
          const sy = obj.scale.y || 1;
          const sz = obj.scale.z || 1;
          
          if (obj.children.length < 5) continue;
          
          const left = obj.children[0] as THREE.Mesh;
          left.scale.set(1/sx, 1, 1);
          left.position.set(-0.5 + 0.01/sx, 1, 0);
          
          const right = obj.children[1] as THREE.Mesh;
          right.scale.set(1/sx, 1, 1);
          right.position.set(0.5 - 0.01/sx, 1, 0);
          
          const top = obj.children[2] as THREE.Mesh;
          top.scale.set(1, 1/sy, 1);
          top.position.set(0, 2 - 0.01/sy, 0);
          
          const bottom = obj.children[3] as THREE.Mesh;
          bottom.scale.set(1, 1/sy, 1);
          bottom.position.set(0, 0.01/sy, 0);
          
          const back = obj.children[4] as THREE.Mesh;
          back.scale.set(1, 1, 1/sz);
          back.position.set(0, 1, -0.5 + 0.01/sz);

          for (let i = 5; i < obj.children.length; i++) {
             const child = obj.children[i] as THREE.Mesh;
             if (child.userData['type'] === 'shelf') {
                child.scale.set((sx - 0.04)/sx, 1/sy, (sz - 0.02)/sz);
                child.position.x = 0;
                child.position.z = 0.01/sz;
             }
          }
       }
    }
  }

private draggingType: string | null = null;
  private phantomMesh: THREE.Object3D | null = null;
  private canDrop: boolean = true;
  private hoverCupboard: THREE.Object3D | null = null;

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
    this.hoverCupboard = null;
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
      // Check if hovering over a cupboard
      const cupboardHit = this.getCupboardIntersection(event);
      
      if (!this.phantomMesh) {
         this.phantomMesh = this.createObject3DOnly(this.draggingType);
         this.scene.add(this.phantomMesh);
      }

if (cupboardHit && this.draggingType === 'shelf') {
         this.positionMeshInsideCupboard(this.phantomMesh, cupboardHit, event);
         this.hoverCupboard = cupboardHit;
      } else {
        this.positionMesh(this.phantomMesh, this.draggingType, intersect);
        this.hoverCupboard = null;
      }
      
      // Collision checking
      this.canDrop = !this.checkCollision(this.phantomMesh, this.hoverCupboard);

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
    this.hoverCupboard = null;
    this.removePhantom();
  }

  public onDrop(event: DragEvent): void {
    event.preventDefault();

    if (this.phantomMesh && this.draggingType && this.canDrop) {
      const type = this.draggingType;
      // We will create a fresh object instead of keeping the phantom to reset properly
      const mesh = this.createObject3DOnly(type);

      if (this.hoverCupboard && type === 'shelf') {
        // Make placement deterministic in cupboard LOCAL space.
        this.positionMeshInsideCupboard(mesh, this.hoverCupboard, event);

        mesh.userData['rootId'] = mesh.uuid;

        const worldPos = mesh.position.clone();
        this.hoverCupboard.add(mesh);
        this.hoverCupboard.updateMatrixWorld(true);
        this.hoverCupboard.worldToLocal(worldPos);
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

      // Add to interactableObjects so nested shelves can be selected/transformed.
      this.interactableObjects.push(mesh);

      const objData: SceneObjectData = { id: mesh.uuid, name: name, mesh: mesh, children: [] };
      if (this.hoverCupboard && type === 'shelf') {
         const parentData = this.findObjectData(this.hoverCupboard.userData['rootId'] || this.hoverCupboard.uuid);
         if (parentData) {
            parentData.children = parentData.children || [];
            parentData.children.push(objData);
         } else {
            this.objectDataList.push(objData);
         }
      } else {
         this.objectDataList.push(objData);
      }
      this.selectObjectById(mesh.uuid);
    }

    this.draggingType = null;
    this.hoverCupboard = null;
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

  private getCupboardIntersection(event: DragEvent | PointerEvent): THREE.Object3D | null {
     const bounds = this.renderer.domElement.getBoundingClientRect();
     this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
     this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
     this.raycaster.setFromCamera(this.mouse, this.camera);

     // Get all cupboards from interactable objects
     const cupboards = this.interactableObjects.filter(obj => obj.userData['type'] === 'cupboard');
     
     if (cupboards.length === 0) return null;

     const intersects = this.raycaster.intersectObjects(cupboards, true);
     if (intersects.length > 0) {
        let obj: THREE.Object3D | null = intersects[0].object;
        while (obj && obj.userData['type'] !== 'cupboard') {
            obj = obj.parent;
        }
        return obj;
     }
     return null;
  }

  private positionMeshInsideCupboard(mesh: THREE.Object3D, cupboard: THREE.Object3D, event: DragEvent | PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects([cupboard], true);
    let hitY = cupboard.position.y + 1; // Default to middle
    if (intersects.length > 0) {
       hitY = intersects[0].point.y;
    }

    // Compute desired position in WORLD space first.
    let sx = 1, sy = 1, sz = 1;
    if (cupboard.scale) {
       sx = cupboard.scale.x;
       sy = cupboard.scale.y;
       sz = cupboard.scale.z;
    }

    if (mesh.userData['type'] === 'shelf') {
       mesh.scale.set(sx - 0.04, 1, sz - 0.02);
    }

    const localZ = 0.01 / sz;
    const localPos = new THREE.Vector3(0, 0, localZ);
    localPos.applyMatrix4(cupboard.matrixWorld);

    mesh.position.set(
      localPos.x, // Centered horizontally in cupboard
      Math.max(cupboard.position.y + 0.01, Math.min(cupboard.position.y + (2 * sy) - 0.01, hitY)),
      localPos.z // Snapped to back
    );
  }


  private createObject3DOnly(type: string): THREE.Object3D {
     if (type === 'cupboard') {
       const group = new THREE.Group();
       group.userData['type'] = 'cupboard';
       
       const material = new THREE.MeshStandardMaterial({ color: '#a8a8a8', roughness: 0.3, metalness: 0.1 });
       
       const left = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2, 1), material);
       left.position.set(-0.49, 1, 0); 
       
       const right = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2, 1), material);
       right.position.set(0.49, 1, 0);
       
       const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), material);
       top.position.set(0, 1.99, 0);
       
       const bottom = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), material);
       bottom.position.set(0, 0.01, 0);
       
       const back = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.02), material);
       back.position.set(0, 1, -0.49);
       
       group.add(left, right, top, bottom, back);
       // We center the group natively around 0,0,0 initially if we want, but anchoring solves it later
       return group;
     }

     let geometry: THREE.BufferGeometry;
     let materialColor = '#38bdf8';
     
     if (type === 'shelf') {
       geometry = new THREE.BoxGeometry(1, 0.02, 1);
       materialColor = '#8b5cf6';
     } else if (type === 'chest') {
       geometry = new THREE.BoxGeometry(1, 0.8, 0.6);
       materialColor = '#f87171';
     } else {
       geometry = new THREE.BoxGeometry(1, 1, 1);
       materialColor = '#38bdf8';
     }

     const material = new THREE.MeshStandardMaterial({ 
       color: materialColor, roughness: 0.2, metalness: 0.5 
     });
     const mesh = new THREE.Mesh(geometry, material);
     mesh.userData['type'] = type;
     return mesh;
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
}
