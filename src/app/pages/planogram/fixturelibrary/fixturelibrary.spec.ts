import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Fixturelibrary } from './fixturelibrary';

describe('Fixturelibrary', () => {
  let component: Fixturelibrary;
  let fixture: ComponentFixture<Fixturelibrary>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Fixturelibrary],
    }).compileComponents();

    fixture = TestBed.createComponent(Fixturelibrary);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
