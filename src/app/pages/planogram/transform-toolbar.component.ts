import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-transform-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transform-toolbar.component.html',
  styleUrl: './transform-toolbar.component.css'
})
export class TransformToolbarComponent {
  /** The current active transform mode (select, translate, rotate, scale) */
  @Input() currentMode: string = 'select';

  /** Emitted when a new mode is selected */
  @Output() modeSelected = new EventEmitter<string>();

  setMode(mode: string): void {
    this.modeSelected.emit(mode);
  }
}