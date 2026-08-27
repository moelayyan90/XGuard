package main

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	x402http "github.com/x402-foundation/x402/go/v2/http"
	ginmw "github.com/x402-foundation/x402/go/v2/http/gin"
	evm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/server"
)

const xguardFacilitatorURL = "https://api.xguardgate.com"
const network = "eip155:8453"

func main() {
	payTo := os.Getenv("PAY_TO")
	if payTo == "" {
		panic("PAY_TO is required")
	}

	facilitator := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
		URL: xguardFacilitatorURL,
	})

	routes := x402http.RoutesConfig{
		"GET /premium": {
			Accepts: x402http.PaymentOptions{
				{Scheme: "exact", Price: "$0.01", Network: network, PayTo: payTo},
			},
			Description: "Premium Gin response settled through XGuard",
			MimeType:    "application/json",
		},
	}

	r := gin.Default()
	r.Use(ginmw.X402Payment(ginmw.Config{
		Routes:      routes,
		Facilitator: facilitator,
		Schemes: []ginmw.SchemeConfig{
			{Network: network, Server: evm.NewExactEvmScheme()},
		},
	}))

	r.GET("/premium", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "facilitator": xguardFacilitatorURL})
	})

	_ = r.Run(":4021")
}
