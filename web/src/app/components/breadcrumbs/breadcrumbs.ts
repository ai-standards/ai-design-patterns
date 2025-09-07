import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-breadcrumbs',
  imports: [RouterLink, MatIconModule],
  templateUrl: './breadcrumbs.html',
  styleUrl: './breadcrumbs.scss'
})
export class Breadcrumbs {
  readonly route = inject(ActivatedRoute);

  readonly activeUrl = toSignal(this.route.url);

  readonly breadcrumbs = computed(() => {
    const url = this.activeUrl();
    let path = [];
    return url ? url.map(s => {
      path.push(s);
      return {
        label: s.path.replace(/-/g, ' '),
        path: '/' + path.join('/')
      }
    }) : [];
  });
}
