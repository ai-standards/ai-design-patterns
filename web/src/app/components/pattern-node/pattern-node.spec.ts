import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PatternNode } from './pattern-node';

describe('PatternNode', () => {
  let component: PatternNode;
  let fixture: ComponentFixture<PatternNode>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PatternNode]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PatternNode);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
