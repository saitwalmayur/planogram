import { Component, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

@Component({
  selector: 'app-scene-hierarchy',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './scene-hierarchy.component.html',
  styleUrl: './scene-hierarchy.component.css'
})
export class SceneHierarchy {
  readonly objects = input.required<any[]>();
  readonly selectedId = input<string | null>(null);

  readonly objectSelected = output<string>();
  readonly visibilityToggled = output<{ event: Event; id: string }>();

  protected onToggleVisibility(event: Event, id: string): void {
    event.stopPropagation();
    this.visibilityToggled.emit({ event, id });
  }
}