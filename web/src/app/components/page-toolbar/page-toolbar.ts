import { Component } from '@angular/core';
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-page-toolbar',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './page-toolbar.html',
  styleUrl: './page-toolbar.scss'
})
export class PageToolbar {

}
