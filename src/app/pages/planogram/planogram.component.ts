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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
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
      mesh: this.rootCube
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
      this.selectedObject = this.objectDataList.find(d => d.id === id) || null;
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

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    if (this.controls) {
      this.controls.update();
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private draggingType: string | null = null;
  private phantomMesh: THREE.Object3D | null = null;

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
      if (!this.phantomMesh) {
         this.phantomMesh = this.createObject3DOnly(this.draggingType);
         this.phantomMesh.traverse((child) => {
           if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
             const mat = child.material;
             mat.transparent = true;
             mat.opacity = 0.5;
             mat.depthWrite = false;
           }
         });
         this.scene.add(this.phantomMesh);
      }
      this.positionMesh(this.phantomMesh, this.draggingType, intersect);
    }
  }

  public onDragLeave(event: DragEvent): void {
    this.removePhantom();
  }

  public onDrop(event: DragEvent): void {
    event.preventDefault();
    
    if (this.phantomMesh && this.draggingType) {
      const type = this.draggingType;
      const mesh = this.phantomMesh;
      
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          const mat = child.material;
          mat.transparent = false;
          mat.opacity = 1.0;
          mat.depthWrite = true;
        }
      });
      // Mark all children to properly select root when raycasted
      mesh.traverse(child => { child.userData['rootId'] = mesh.uuid; });
      
      let name = 'New Object';
      if (type === 'cube') name = 'Standard Cube';
      else if (type === 'shelf') name = 'Rectangle Shelf';
      else if (type === 'cupboard') name = 'Open Cupboard';
      else if (type === 'chest') name = 'Storage Chest';

      this.interactableObjects.push(mesh);
      this.objectDataList.push({ id: mesh.uuid, name: name, mesh: mesh });

      this.selectObjectById(mesh.uuid);
      
      // Detach phantom reference so it is preserved
      this.phantomMesh = null;
    }
    
    this.draggingType = null;
    this.removePhantom();
  }

  private removePhantom(): void {
    if (this.phantomMesh) {
      this.scene.remove(this.phantomMesh);
      this.phantomMesh = null;
    }
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

  private createObject3DOnly(type: string): THREE.Object3D {
     if (type === 'cupboard') {
       const group = new THREE.Group();
       const material = new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.3, metalness: 0.1 });
       
       const left = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 1), material);
       left.position.set(-0.45, 1, 0); 
       
       const right = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 1), material);
       right.position.set(0.45, 1, 0);
       
       const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), material);
       top.position.set(0, 1.95, 0);
       
       const bottom = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), material);
       bottom.position.set(0, 0.05, 0);
       
       const back = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), material);
       back.position.set(0, 1, -0.45);
       
       group.add(left, right, top, bottom, back);
       // We center the group natively around 0,0,0 initially if we want, but anchoring solves it later
       return group;
     }

     let geometry: THREE.BufferGeometry;
     let materialColor = '#38bdf8';
     
     if (type === 'shelf') {
       geometry = new THREE.BoxGeometry(2, 0.1, 0.5);
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
     return new THREE.Mesh(geometry, material);
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
