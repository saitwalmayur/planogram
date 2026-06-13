import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-properties-panel',
  imports: [CommonModule, FormsModule],
  templateUrl: './properties-panel.component.html',
  styleUrl: './properties-panel.component.scss'
})
export class PropertiesPanelComponent {
  @Input() selectedObject: any = null;
  @Input() transform: any = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  };
  @Output() transformUpdated = new EventEmitter<void>();

  onTransformChange() {
    this.transformUpdated.emit();
  }
}
